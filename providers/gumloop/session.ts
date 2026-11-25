import { z } from "zod";

import type { StorageSessionLike } from "../tab-ensure";
import type { GumloopSessionCredentials } from "./adapter";
import type { GumloopPageSession } from "./page-session";

// Gumloop signs in with Firebase: a one-hour ID token plus a long-lived
// refresh token, both kept by the gumloop.com page in IndexedDB. Holding them
// in memory-backed chrome.storage.session lets the background worker renew the
// ID token without a Gumloop tab until the browser exits. Nothing is written
// to persistent storage.
export const GUMLOOP_SESSION_KEY = "gumloopSession";
// Firebase's token service, the same one the gumloop.com page calls itself.
export const GUMLOOP_TOKEN_ENDPOINT =
  "https://securetoken.googleapis.com/v1/token";
// Treat a token as spent a minute early so a request does not race expiry.
export const GUMLOOP_ACCESS_EXPIRY_MARGIN_MS = 60_000;

const token = z.string().trim().min(1).max(8_192);

const storedSessionSchema = z.object({
  refreshToken: token,
  apiKey: z.string().trim().min(1).max(256),
  userId: z.string().trim().min(1).max(256),
  accessToken: token.optional(),
  accessExpiresAt: z.number().finite().positive().optional(),
});

export type GumloopStoredSession = z.infer<typeof storedSessionSchema>;

const refreshResponseSchema = z.object({
  id_token: token.optional(),
  access_token: token.optional(),
  refresh_token: token,
  expires_in: z.union([z.string(), z.number()]).optional(),
  user_id: z.string().trim().min(1).max(256).optional(),
});

const REJECTED_REFRESH_ERRORS = new Set([
  "INVALID_REFRESH_TOKEN",
  "TOKEN_EXPIRED",
  "USER_DISABLED",
  "USER_NOT_FOUND",
  "INVALID_GRANT_TYPE",
  "MISSING_REFRESH_TOKEN",
]);

export type GumloopRefreshOutcome =
  | {
      kind: "refreshed";
      accessToken: string;
      refreshToken: string;
      accessExpiresAt?: number;
      userId?: string;
    }
  | { kind: "rejected" }
  | { kind: "unavailable" };

export async function readGumloopStoredSession(
  storage: StorageSessionLike,
): Promise<GumloopStoredSession | undefined> {
  try {
    const items = await storage.get(GUMLOOP_SESSION_KEY);
    const parsed = storedSessionSchema.safeParse(items[GUMLOOP_SESSION_KEY]);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function refreshErrorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  const message = (error as { message?: unknown }).message;
  // Firebase may append detail after a colon, e.g. "TOKEN_EXPIRED : ...".
  return typeof message === "string" ? message.split(":")[0]!.trim() : undefined;
}

export async function exchangeGumloopRefreshToken({
  fetch: injectedFetch,
  refreshToken,
  apiKey,
  signal,
  now,
}: {
  fetch: typeof globalThis.fetch;
  refreshToken: string;
  apiKey: string;
  signal: AbortSignal;
  now: number;
}): Promise<GumloopRefreshOutcome> {
  let response: Response;
  try {
    response = await injectedFetch(
      `${GUMLOOP_TOKEN_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).toString(),
        signal,
      },
    );
  } catch {
    return { kind: "unavailable" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "unavailable" };
  }
  if (!response.ok) {
    const code = refreshErrorCode(body);
    return code !== undefined && REJECTED_REFRESH_ERRORS.has(code)
      ? { kind: "rejected" }
      : { kind: "unavailable" };
  }
  const parsed = refreshResponseSchema.safeParse(body);
  const accessToken = parsed.success
    ? (parsed.data.id_token ?? parsed.data.access_token)
    : undefined;
  if (!parsed.success || !accessToken) return { kind: "unavailable" };
  const seconds = Number(parsed.data.expires_in);
  return {
    kind: "refreshed",
    accessToken,
    refreshToken: parsed.data.refresh_token,
    ...(Number.isFinite(seconds) && seconds > 0
      ? { accessExpiresAt: now + seconds * 1_000 }
      : {}),
    ...(parsed.data.user_id ? { userId: parsed.data.user_id } : {}),
  };
}

export interface GumloopSessionHolder {
  /**
   * Credentials from the held session, renewing the ID token when the cached
   * one is missing, about to expire, or the one the caller saw rejected.
   * Never opens a tab, so scheduled refresh may use it.
   */
  credentialsFor(
    rejectedToken: string | undefined,
    signal: AbortSignal,
  ): Promise<GumloopSessionCredentials | undefined>;
  /** Marks the start of a page read; pass the result to rememberPageSession. */
  beginPageRead(): number;
  /** Holds what a page read returned; a signed-out page drops the session. */
  rememberPageSession(
    session: GumloopPageSession,
    startedIn: number,
  ): Promise<void>;
  /** Drops the held session; writes still in flight are discarded. */
  forget(): Promise<void>;
}

export function createGumloopSessionHolder({
  storage,
  fetch: injectedFetch,
  now = Date.now,
}: {
  storage: StorageSessionLike;
  fetch: typeof globalThis.fetch;
  now?: () => number;
}): GumloopSessionHolder {
  let inFlight: Promise<GumloopSessionCredentials | undefined> | undefined;
  // Bumped by forget(), so a read or renewal that finishes after a disconnect
  // cannot bring the session back.
  let generation = 0;

  const saveIfCurrent = async (
    startedIn: number,
    session: GumloopStoredSession,
  ): Promise<boolean> => {
    if (startedIn !== generation) return false;
    await storage.set({ [GUMLOOP_SESSION_KEY]: session });
    if (startedIn !== generation) {
      await storage.remove(GUMLOOP_SESSION_KEY).catch(() => undefined);
      return false;
    }
    return true;
  };

  const renew = async (
    session: GumloopStoredSession,
    signal: AbortSignal,
    startedIn: number,
  ): Promise<GumloopSessionCredentials | undefined> => {
    const outcome = await exchangeGumloopRefreshToken({
      fetch: injectedFetch,
      refreshToken: session.refreshToken,
      apiKey: session.apiKey,
      signal,
      now: now(),
    });
    if (outcome.kind === "rejected") {
      // Only forget the token we tried; a page read may have stored a newer one.
      const current = await readGumloopStoredSession(storage);
      if (current?.refreshToken === session.refreshToken) {
        await storage.remove(GUMLOOP_SESSION_KEY).catch(() => undefined);
      }
      return undefined;
    }
    if (outcome.kind !== "refreshed") return undefined;
    if (outcome.userId !== undefined && outcome.userId !== session.userId) {
      return undefined;
    }
    const saved = await saveIfCurrent(startedIn, {
      refreshToken: outcome.refreshToken,
      apiKey: session.apiKey,
      userId: session.userId,
      accessToken: outcome.accessToken,
      ...(outcome.accessExpiresAt !== undefined
        ? { accessExpiresAt: outcome.accessExpiresAt }
        : {}),
    }).catch(() => false);
    return saved && !signal.aborted
      ? { accessToken: outcome.accessToken, userId: session.userId }
      : undefined;
  };

  return {
    async credentialsFor(rejectedToken, signal) {
      if (signal.aborted) return undefined;
      // Same tick as the abort check: a disconnect aborts before it forgets.
      const startedIn = generation;
      const session = await readGumloopStoredSession(storage);
      if (!session) return undefined;

      if (
        session.accessToken !== undefined &&
        session.accessToken !== rejectedToken &&
        session.accessExpiresAt !== undefined &&
        session.accessExpiresAt - GUMLOOP_ACCESS_EXPIRY_MARGIN_MS > now()
      ) {
        return { accessToken: session.accessToken, userId: session.userId };
      }

      inFlight ??= renew(session, signal, startedIn).finally(() => {
        inFlight = undefined;
      });
      try {
        const credentials = await inFlight;
        return credentials?.accessToken === rejectedToken
          ? undefined
          : credentials;
      } catch {
        return undefined;
      }
    },

    beginPageRead: () => generation,

    async rememberPageSession(session, startedIn) {
      if (startedIn !== generation) return;
      if (session.signedOut) {
        generation += 1;
        await storage.remove(GUMLOOP_SESSION_KEY);
        return;
      }
      if (!session.refreshToken || !session.apiKey || !session.userId) return;
      const current = await readGumloopStoredSession(storage);
      // Keep a newer renewal of the same chain over an older page token.
      const pageAccessFresher =
        session.accessToken !== undefined &&
        session.accessExpiresAt !== undefined &&
        (current?.accessExpiresAt === undefined ||
          session.accessExpiresAt >= current.accessExpiresAt);
      const sameUser = current?.userId === session.userId;
      const keepCurrentAccess =
        sameUser && !pageAccessFresher && current?.accessToken !== undefined;
      await saveIfCurrent(startedIn, {
        refreshToken: session.refreshToken,
        apiKey: session.apiKey,
        userId: session.userId,
        ...(keepCurrentAccess
          ? {
              accessToken: current!.accessToken,
              ...(current!.accessExpiresAt !== undefined
                ? { accessExpiresAt: current!.accessExpiresAt }
                : {}),
            }
          : session.accessToken !== undefined &&
              session.accessExpiresAt !== undefined
            ? {
                accessToken: session.accessToken,
                accessExpiresAt: session.accessExpiresAt,
              }
            : {}),
      });
    },

    async forget() {
      generation += 1;
      await storage.remove(GUMLOOP_SESSION_KEY);
    },
  };
}
