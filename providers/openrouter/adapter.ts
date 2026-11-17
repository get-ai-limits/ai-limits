import type {
  BalanceMetric,
  ProviderHealth,
  QuotaMetric,
  UsageMetric,
  UsageSnapshot,
} from "../../domain/model";
import { retryAtFromResponse } from "../retry-after";
import type {
  CollectionContext,
  CollectionResult,
  ProviderCollector,
} from "../types";
import {
  openRouterCreditsResponseSchema,
  openRouterKeyResponseSchema,
  type OpenRouterKeyData,
} from "./schema";
import {
  CREDITS_PAGE_URL,
  PROMO_CREDITS_METRIC_ID,
  parseCreditsPage,
  promoCreditMetric,
} from "./grants";

// The upstream reference implementation defaults to
// https://openrouter.ai/api/v1 and reads GET {base}/credits, then GET
// {base}/key.
const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const KEY_URL = "https://openrouter.ai/api/v1/key";

// Product client title sent as X-Title on the credits request.
const CLIENT_TITLE = "AI Limits";

function healthForResponse(response: Response, now: number): ProviderHealth {
  if (response.status === 401 || response.status === 403) {
    return { kind: "credential_invalid" };
  }

  if (response.status === 429 || response.status >= 500) {
    const retryAt = retryAtFromResponse(response, now);
    return {
      kind: "temporary_error",
      ...(retryAt === undefined ? {} : { retryAt }),
    };
  }

  return { kind: "provider_changed" };
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function present(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resetWindowUsage(key: OpenRouterKeyData): number | undefined {
  // openrouter.js resetWindowUsage (lines 258-269).
  switch (key.limit_reset) {
    case "daily":
      return present(key.usage_daily);
    case "weekly":
      return present(key.usage_weekly);
    case "monthly":
      return present(key.usage_monthly);
    default:
      return undefined;
  }
}

function keyUsedForQuota(key: OpenRouterKeyData, keyLimit: number): number | undefined {
  // openrouter.js keyUsedForQuota (lines 273-283): prefer server remaining,
  // then the reset-window usage, then cumulative usage.
  const remaining = present(key.limit_remaining);
  if (remaining !== undefined) {
    return keyLimit - Math.min(keyLimit, Math.max(0, remaining));
  }
  const windowUsage = resetWindowUsage(key);
  if (windowUsage !== undefined) return windowUsage;
  return present(key.usage);
}

function keyBudgetMetric(key: OpenRouterKeyData): QuotaMetric | undefined {
  const keyLimit = present(key.limit);
  if (keyLimit === undefined || keyLimit <= 0) return undefined;
  const used = keyUsedForQuota(key, keyLimit);
  if (used === undefined || used < 0) return undefined;
  return {
    type: "quota",
    id: "key-budget",
    label: "API key budget",
    scope: "product",
    usedRatio: Math.min(1, used / keyLimit),
    used,
    limit: keyLimit,
    unit: "USD",
  };
}

function creditsBalance(totalCredits: number, totalUsage: number): BalanceMetric | undefined {
  if (!Number.isFinite(totalCredits) || !Number.isFinite(totalUsage)) {
    return undefined;
  }
  const remaining = Math.max(0, totalCredits - totalUsage);
  return {
    type: "balance",
    id: "balance",
    label: "Balance",
    scope: "general",
    value: remaining,
    unit: "USD",
    ...(totalCredits > 0 ? { initialLimit: totalCredits } : {}),
  };
}

// The Credits page is optional enrichment; it gets its own short budget so a
// slow page never turns a successful API refresh into a timeout.
const PAGE_TIMEOUT_MS = 5_000;
// openrouter.ai sign-in uses short-lived session tokens that are renewed while
// a site tab is open, so a background read can see a signed-out page in
// between visits. The last matching reading is carried for a bounded time.
const PROMO_CARRY_MS = 24 * 60 * 60 * 1_000;

type PromoRead =
  | { kind: "read"; metric: BalanceMetric | undefined }
  | { kind: "unavailable" };

async function readPromoCredits(
  fetch: typeof globalThis.fetch,
  signal: AbortSignal,
  now: number,
  keyOwner: string,
): Promise<PromoRead> {
  try {
    const response = await fetch(CREDITS_PAGE_URL, {
      method: "GET",
      credentials: "include",
      redirect: "error",
      headers: { RSC: "1" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]),
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("text/x-component")
    ) {
      return { kind: "unavailable" };
    }
    const page = parseCreditsPage(await response.text());
    if (!page) return { kind: "unavailable" };
    // A different signed-in account is a definite answer: show nothing.
    if (page.userId !== keyOwner) return { kind: "read", metric: undefined };
    return { kind: "read", metric: promoCreditMetric(page.pools, now) };
  } catch {
    return { kind: "unavailable" };
  }
}

function carriedPromoCredits(
  previous: UsageSnapshot | undefined,
  now: number,
): BalanceMetric | undefined {
  if (previous?.providerKind !== "openrouter") return undefined;
  const metric = previous.metrics.find(
    (candidate) => candidate.id === PROMO_CREDITS_METRIC_ID,
  );
  if (metric?.type !== "balance") return undefined;
  const observedAt = metric.observedAt ?? previous.fetchedAt;
  if (!(observedAt <= now && now - observedAt < PROMO_CARRY_MS)) return undefined;
  return { ...metric, observedAt };
}

/**
 * Optional promotional-credit enrichment from the signed-in Credits page.
 * Shown only when the key is a personal key created by the same account that
 * is signed in to openrouter.ai. When the page cannot be read, the previous
 * matching reading is carried for up to a day; otherwise the metric is hidden.
 */
async function promoCredits(
  context: CollectionContext,
  key: OpenRouterKeyData | undefined,
): Promise<BalanceMetric | undefined> {
  const keyOwner = key?.creator_user_id;
  if (!keyOwner || key.organization_id) return undefined;
  const read = await readPromoCredits(
    context.fetch,
    context.signal,
    context.now,
    keyOwner,
  );
  return read.kind === "read"
    ? read.metric
    : carriedPromoCredits(context.previousSnapshot, context.now);
}

async function collectOpenRouter(
  context: CollectionContext,
): Promise<CollectionResult> {
  const { credential, fetch, now, signal } = context;
  if (
    credential?.kind !== "api-key" ||
    typeof credential.value !== "string" ||
    !credential.value.trim()
  ) {
    return { ok: false, health: { kind: "signed_out" } };
  }

  const authorization = `Bearer ${credential.value.trim()}`;
  const accept = { Accept: "application/json", Authorization: authorization };

  try {
    const creditsResponse = await fetch(CREDITS_URL, {
      method: "GET",
      headers: {
        ...accept,
        "X-Title": CLIENT_TITLE,
      },
      signal,
    });
    if (!creditsResponse.ok) {
      return { ok: false, health: healthForResponse(creditsResponse, now) };
    }

    const credits = openRouterCreditsResponseSchema.safeParse(
      await parseJson(creditsResponse),
    );
    if (!credits.success) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const balance = creditsBalance(
      credits.data.data.total_credits,
      credits.data.data.total_usage,
    );
    if (balance === undefined) {
      return { ok: false, health: { kind: "provider_changed" } };
    }

    const metrics: UsageMetric[] = [balance];
    let keyData: OpenRouterKeyData | undefined;

    try {
      const keyResponse = await fetch(KEY_URL, {
        method: "GET",
        headers: accept,
        signal,
      });
      if (keyResponse.ok) {
        const key = openRouterKeyResponseSchema.safeParse(
          await parseJson(keyResponse),
        );
        if (key.success) {
          keyData = key.data.data;
          const quota = keyBudgetMetric(keyData);
          if (quota) metrics.push(quota);
        }
      }
    } catch {
      // Key enrichment is optional (openrouter.js lines 71-103).
    }

    const promo = await promoCredits(context, keyData);
    if (promo) metrics.push(promo);

    return {
      ok: true,
      snapshot: {
        providerKind: "openrouter",
        source: "api-key",
        fetchedAt: now,
        metrics,
      },
    };
  } catch {
    return { ok: false, health: { kind: "temporary_error" } };
  }
}

export const openRouterAdapter: ProviderCollector<"openrouter"> = {
  id: "openrouter",
  collect: collectOpenRouter,
};
