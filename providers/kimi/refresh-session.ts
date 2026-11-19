import { z } from "zod";

import type { StorageSessionLike } from "../tab-ensure";

// Kimi's web app keeps a short-lived access token (about 15 minutes) and a
// long-lived refresh token in page localStorage. The page itself only renews
// the access token while a Kimi tab is open, so scheduled refresh used to stall
// once that tab closed. Holding the refresh token in memory-backed
// chrome.storage.session lets the background worker renew the access token
// itself until the browser restarts; nothing is written to persistent storage.
export const KIMI_REFRESH_SESSION_KEY = "kimiRefreshSession";
export const KIMI_REFRESH_ENDPOINT =
  "https://auth.kimi.com/api/account.gateway.v1.AuthService/RefreshToken";
// Treat a cached access token as spent a minute before Kimi does, so a request
// does not race its expiry.
export const KIMI_ACCESS_EXPIRY_MARGIN_MS = 60_000;

const nonEmptyToken = z.string().trim().min(1);

const storedSessionSchema = z.object({
  refreshToken: nonEmptyToken,
  accessToken: nonEmptyToken.optional(),
  accessExpiresAt: z.number().finite().positive().optional(),
  // The page's refresh token this chain was last taken from.
  pageRefreshToken: nonEmptyToken.optional(),
});

const refreshResponseSchema = z.object({
  accessToken: nonEmptyToken,
  refreshToken: nonEmptyToken,
});

const connectErrorSchema = z.object({ code: z.string() });

export type KimiStoredSession = z.infer<typeof storedSessionSchema>;

export type KimiRefreshOutcome =
  | { kind: "refreshed"; accessToken: string; refreshToken: string }
  | { kind: "rejected" }
  | { kind: "unavailable" };

/** Reads the unverified `exp` claim only to decide when to stop reusing it. */
export function kimiTokenExpiresAt(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const claims: unknown = JSON.parse(atob(padded));
    const exp =
      typeof claims === "object" && claims !== null
        ? (claims as { exp?: unknown }).exp
        : undefined;
    return typeof exp === "number" && Number.isFinite(exp) && exp > 0
      ? exp * 1_000
      : undefined;
  } catch {
    return undefined;
  }
}

export async function readKimiStoredSession(
  storage: StorageSessionLike,
): Promise<KimiStoredSession | undefined> {
  try {
    const items = await storage.get(KIMI_REFRESH_SESSION_KEY);
    const parsed = storedSessionSchema.safeParse(
      items[KIMI_REFRESH_SESSION_KEY],
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function saveKimiStoredSession(
  storage: StorageSessionLike,
  session: {
    refreshToken: string;
    accessToken?: string;
    pageRefreshToken?: string;
  },
): Promise<void> {
  const refreshToken = session.refreshToken.trim();
  if (!refreshToken) return;
  const accessToken = session.accessToken?.trim();
  const accessExpiresAt = accessToken
    ? kimiTokenExpiresAt(accessToken)
    : undefined;
  const pageRefreshToken = session.pageRefreshToken?.trim();
  const value: KimiStoredSession = {
    refreshToken,
    ...(pageRefreshToken ? { pageRefreshToken } : {}),
    // Cache the access token only when its expiry is readable, so a token of
    // unknown age is never reused past its life.
    ...(accessToken && accessExpiresAt !== undefined
      ? { accessToken, accessExpiresAt }
      : {}),
  };
  await storage.set({ [KIMI_REFRESH_SESSION_KEY]: value });
}

export async function clearKimiStoredSession(
  storage: StorageSessionLike,
): Promise<void> {
  await storage.remove(KIMI_REFRESH_SESSION_KEY);
}

export async function exchangeKimiRefreshToken({
  fetch: injectedFetch,
  refreshToken,
  signal,
}: {
  fetch: typeof globalThis.fetch;
  refreshToken: string;
  signal: AbortSignal;
}): Promise<KimiRefreshOutcome> {
  let response: Response;
  try {
    // Kimi's refresh call carries the token in the body and needs no cookies.
    response = await injectedFetch(KIMI_REFRESH_ENDPOINT, {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: JSON.stringify({ refreshToken }),
      signal,
    });
  } catch {
    return { kind: "unavailable" };
  }

  if (response.status === 401 || response.status === 403) {
    return { kind: "rejected" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "unavailable" };
  }
  if (!response.ok) {
    // Connect-protocol errors carry a code; an invalid or expired token may
    // come back as one of these with a non-auth HTTP status.
    const code = connectErrorSchema.safeParse(body);
    return code.success &&
      (code.data.code === "unauthenticated" ||
        code.data.code === "permission_denied")
      ? { kind: "rejected" }
      : { kind: "unavailable" };
  }
  const parsed = refreshResponseSchema.safeParse(body);
  return parsed.success
    ? { kind: "refreshed", ...parsed.data }
    : { kind: "unavailable" };
}

export interface KimiSessionHolder {
  /**
   * Returns an access token from the in-memory session, renewing it with the
   * held refresh token when the cached one is missing, expired, or the token
   * the caller just saw Kimi reject. Concurrent callers share one renewal.
   */
  tokenFor(
    rejectedToken: string | undefined,
    signal: AbortSignal,
  ): Promise<string | undefined>;
  /** Marks the start of a page read; pass the result to rememberPageSession. */
  beginPageRead(): number;
  /**
   * Holds the tokens read from a Kimi page whose read began at `startedIn`.
   * A mounted page with neither token is signed out, so the held session is
   * dropped too.
   */
  rememberPageSession(
    session: { accessToken?: string; refreshToken?: string },
    startedIn: number,
  ): Promise<void>;
  hasSession(): Promise<boolean>;
  /** Drops the held session; writes still in flight are discarded. */
  forget(): Promise<void>;
}

export function createKimiSessionHolder({
  storage,
  fetch: injectedFetch,
  now = Date.now,
}: {
  storage: StorageSessionLike;
  fetch: typeof globalThis.fetch;
  now?: () => number;
}): KimiSessionHolder {
  let inFlight: Promise<string | undefined> | undefined;
  // Bumped by forget(), so a page read or renewal that finishes after a
  // disconnect cannot bring the session back.
  let generation = 0;

  const saveIfCurrent = async (
    startedIn: number,
    session: Parameters<typeof saveKimiStoredSession>[1],
  ): Promise<boolean> => {
    if (startedIn !== generation) return false;
    await saveKimiStoredSession(storage, session);
    if (startedIn !== generation) {
      await clearKimiStoredSession(storage).catch(() => undefined);
      return false;
    }
    return true;
  };

  const renew = async (
    session: KimiStoredSession,
    signal: AbortSignal,
    startedIn: number,
  ): Promise<string | undefined> => {
    const outcome = await exchangeKimiRefreshToken({
      fetch: injectedFetch,
      refreshToken: session.refreshToken,
      signal,
    });
    if (outcome.kind === "rejected") {
      // Only forget the token we tried; a page read may have stored a newer one.
      const current = await readKimiStoredSession(storage);
      if (current?.refreshToken === session.refreshToken) {
        await clearKimiStoredSession(storage).catch(() => undefined);
      }
      return undefined;
    }
    if (outcome.kind !== "refreshed") return undefined;
    // Kimi has already rotated the pair, so keep it even if this caller was
    // aborted meanwhile; dropping it would strand the held chain.
    const saved = await saveIfCurrent(startedIn, {
      accessToken: outcome.accessToken,
      refreshToken: outcome.refreshToken,
      pageRefreshToken: session.pageRefreshToken,
    }).catch(() => false);
    return saved && !signal.aborted ? outcome.accessToken : undefined;
  };

  return {
    async tokenFor(rejectedToken, signal) {
      if (signal.aborted) return undefined;
      // Same tick as the abort check: a disconnect aborts before it forgets.
      const startedIn = generation;
      const session = await readKimiStoredSession(storage);
      if (!session) return undefined;

      if (
        session.accessToken !== undefined &&
        session.accessToken !== rejectedToken &&
        session.accessExpiresAt !== undefined &&
        session.accessExpiresAt - KIMI_ACCESS_EXPIRY_MARGIN_MS > now()
      ) {
        return session.accessToken;
      }

      inFlight ??= renew(session, signal, startedIn).finally(() => {
        inFlight = undefined;
      });
      try {
        const token = await inFlight;
        return token === rejectedToken ? undefined : token;
      } catch {
        return undefined;
      }
    },

    beginPageRead: () => generation,

    async hasSession() {
      return (await readKimiStoredSession(storage)) !== undefined;
    },

    async rememberPageSession({ accessToken, refreshToken }, startedIn) {
      if (startedIn !== generation) return;
      const pageRefreshToken = refreshToken?.trim();
      if (!pageRefreshToken) {
        if (!accessToken?.trim()) {
          // Kimi has mounted without any session: the user signed out.
          generation += 1;
          await clearKimiStoredSession(storage);
        }
        return;
      }
      const current = await readKimiStoredSession(storage);
      // The page still holds the token this chain started from; the held
      // chain may already be newer, so leave it alone.
      if (current?.pageRefreshToken === pageRefreshToken) return;
      await saveIfCurrent(startedIn, {
        refreshToken: pageRefreshToken,
        accessToken,
        pageRefreshToken,
      });
    },

    async forget() {
      generation += 1;
      await clearKimiStoredSession(storage);
    },
  };
}
