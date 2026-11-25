import type {
  BalanceMetric,
  MetricCycle,
  ProviderHealth,
  QuotaMetric,
  UsageSnapshot,
} from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import {
  gumloopCreditsSchema,
  gumloopProjectListSchema,
  gumloopSubscriptionSchema,
  type GumloopSubscription,
} from "./schema";

export const GUMLOOP_API_ORIGIN = "https://api.gumloop.com";

/** One HTTP answer, from the background worker or from a gumloop.com page. */
export interface GumloopReply {
  status: number;
  body?: unknown;
  /** Retry-After header value, when the provider sent one. */
  retryAfter?: string;
}

/**
 * The three reads behind Gumloop's own Credit Usage page. The organization id
 * from `project` is used only to build the next two paths and is not kept.
 */
export interface GumloopReplies {
  project: GumloopReply;
  remaining?: GumloopReply;
  subscription?: GumloopReply;
}

export type GumloopOutcome =
  | { kind: "snapshot"; snapshot: UsageSnapshot }
  /** Gumloop rejected the access token; a renewed one may succeed. */
  | { kind: "auth_rejected" }
  /**
   * The request never got a usable answer from the background worker (network
   * failure, or a 403 that may be an origin check). A gumloop.com page may
   * still succeed.
   */
  | { kind: "unreachable" }
  | { kind: "failed"; health: ProviderHealth };

export interface GumloopSessionCredentials {
  accessToken: string;
  userId: string;
}

export function gumloopRequestHeaders({
  accessToken,
  userId,
}: GumloopSessionCredentials): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    "x-auth-key": userId,
  };
}

async function readReply(response: Response): Promise<GumloopReply> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const retryAfter = response.headers.get("retry-after") ?? undefined;
  return {
    status: response.status,
    ...(body === undefined ? {} : { body }),
    ...(retryAfter === undefined ? {} : { retryAfter }),
  };
}

export function gumloopOrganizationId(project: GumloopReply): string | undefined {
  if (project.status !== 200) return undefined;
  const parsed = gumloopProjectListSchema.safeParse(project.body);
  if (!parsed.success) return undefined;
  for (const entry of parsed.data) {
    const id = entry.organization_id?.trim();
    // Only ids that are safe to place in a URL path segment.
    if (id && /^[A-Za-z0-9_-]{1,128}$/.test(id)) return id;
  }
  return undefined;
}

/** Fetches the three reads from the background worker. */
export async function fetchGumloopReplies({
  fetch: injectedFetch,
  credentials,
  signal,
}: {
  fetch: typeof globalThis.fetch;
  credentials: GumloopSessionCredentials;
  signal: AbortSignal;
}): Promise<GumloopReplies | undefined> {
  const get = async (path: string) =>
    readReply(
      await injectedFetch(`${GUMLOOP_API_ORIGIN}${path}`, {
        method: "GET",
        credentials: "omit",
        headers: gumloopRequestHeaders(credentials),
        signal,
      }),
    );
  try {
    const project = await get("/project");
    const organizationId = gumloopOrganizationId(project);
    if (!organizationId) return { project };
    const base = `/organization/${encodeURIComponent(organizationId)}`;
    const [remaining, subscription] = await Promise.all([
      get(`${base}/credits`),
      get(`${base}/subscription`),
    ]);
    return { project, remaining, subscription };
  } catch {
    return undefined;
  }
}

function failureFor(reply: GumloopReply, now: number): GumloopOutcome {
  if (reply.status === 401) return { kind: "auth_rejected" };
  // Includes the network-level failures a page reports as status 0.
  if (reply.status === 0 || reply.status === 403) return { kind: "unreachable" };
  if (reply.status === 429 || reply.status >= 500) {
    const retryAt =
      reply.retryAfter === undefined
        ? undefined
        : retryAtFromResponse(
            new Response(null, { headers: { "retry-after": reply.retryAfter } }),
            now,
          );
    return {
      kind: "failed",
      health: {
        kind: "temporary_error",
        ...(retryAt === undefined ? {} : { retryAt }),
      },
    };
  }
  return { kind: "failed", health: { kind: "provider_changed" } };
}

function cycleFor(
  subscription: GumloopSubscription,
  now: number,
): MetricCycle | undefined {
  const endSeconds =
    subscription.next_reset?.at ?? subscription.current_period_end ?? undefined;
  const resetsAt = endSeconds === undefined ? undefined : endSeconds * 1_000;
  if (resetsAt === undefined || resetsAt <= now) return undefined;
  const startSeconds = subscription.current_period_start ?? undefined;
  const startedAt = startSeconds === undefined ? undefined : startSeconds * 1_000;
  if (startedAt === undefined || startedAt > now || startedAt >= resetsAt) {
    return { cadence: "calendar", resetsAt };
  }
  return {
    cadence: "calendar",
    startedAt,
    resetsAt,
    durationMs: resetsAt - startedAt,
  };
}

function planLabel(tier: string | null | undefined): string | undefined {
  const value = tier?.trim();
  if (!value || value.length > 40) return undefined;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function gumloopOutcomeFromReplies(
  replies: GumloopReplies,
  now: number,
): GumloopOutcome {
  if (replies.project.status !== 200) return failureFor(replies.project, now);
  if (!replies.remaining || !replies.subscription) {
    // Signed in, but no organization to read credits for.
    return { kind: "failed", health: { kind: "provider_changed" } };
  }
  for (const reply of [replies.remaining, replies.subscription]) {
    if (reply.status !== 200) return failureFor(reply, now);
  }

  const credits = gumloopCreditsSchema.safeParse(replies.remaining.body);
  const subscription = gumloopSubscriptionSchema.safeParse(
    replies.subscription.body,
  );
  if (!credits.success || !subscription.success) {
    return { kind: "failed", health: { kind: "provider_changed" } };
  }

  const remaining = credits.data.remaining;
  const allotment = subscription.data.allotment ?? 0;
  const cycle = cycleFor(subscription.data, now);
  const identity = {
    id: "monthly-credits",
    label: "Monthly credits",
    scope: "general",
    ...(cycle ? { cycle } : {}),
  } as const;

  const metric: QuotaMetric | BalanceMetric =
    allotment > 0
      ? (() => {
          // Remaining can exceed the allotment (extra credits) or go below
          // zero (overage); the quota itself stays within its bounds.
          const used = Math.min(allotment, Math.max(0, allotment - remaining));
          return {
            ...identity,
            type: "quota",
            usedRatio: used / allotment,
            used,
            limit: allotment,
            unit: "credits",
          };
        })()
      : {
          ...identity,
          type: "balance",
          value: Math.max(0, remaining),
          unit: "credits",
        };

  const plan = planLabel(subscription.data.tier);
  return {
    kind: "snapshot",
    snapshot: {
      providerKind: "gumloop",
      ...(plan ? { planLabel: plan } : {}),
      source: "web-session",
      fetchedAt: now,
      metrics: [metric],
    },
  };
}
