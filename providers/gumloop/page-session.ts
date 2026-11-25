export const GUMLOOP_ORIGIN = "https://www.gumloop.com";

/**
 * What a gumloop.com page holds for its signed-in Firebase user. A page with
 * no signed-in user reads as `{ signedOut: true }`.
 */
export interface GumloopPageSession {
  signedOut?: true;
  accessToken?: string;
  accessExpiresAt?: number;
  refreshToken?: string;
  /** Firebase web API key; public by design, needed to renew the session. */
  apiKey?: string;
  userId?: string;
}

/**
 * Runs inside a gumloop.com page (MAIN world). Reads only the Firebase auth
 * entry Gumloop's sign-in keeps in IndexedDB. It must stay self-contained:
 * the browser serializes it without its module scope.
 */
export async function readGumloopPageSessionAtExpectedOrigin(
  expectedOrigin: string,
): Promise<unknown> {
  if (globalThis.location.origin !== expectedOrigin) return undefined;
  const DB_NAME = "firebaseLocalStorageDb";
  const STORE = "firebaseLocalStorage";
  const db = await new Promise<IDBDatabase | undefined>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME);
    } catch {
      resolve(undefined);
      return;
    }
    // Never create the database: an upgrade means it does not exist yet.
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
    request.onblocked = () => resolve(undefined);
  });
  // Firebase creates the store before the app can sign in, so a missing
  // database means the page has not finished starting.
  if (!db) return undefined;
  try {
    if (!db.objectStoreNames.contains(STORE)) return undefined;
    const entries = await new Promise<unknown[]>((resolve, reject) => {
      const request = db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        // Only the signed-in user entries, keyed "firebase:authUser:...".
        .getAll(
          IDBKeyRange.bound("firebase:authUser:", "firebase:authUser:\uffff"),
        );
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as { fbase_key?: unknown; value?: unknown };
      if (
        typeof record.fbase_key !== "string" ||
        !record.fbase_key.startsWith("firebase:authUser:")
      ) {
        continue;
      }
      const user = record.value as
        | {
            uid?: unknown;
            apiKey?: unknown;
            stsTokenManager?: {
              accessToken?: unknown;
              refreshToken?: unknown;
              expirationTime?: unknown;
            };
          }
        | undefined;
      const tokens = user?.stsTokenManager;
      return {
        accessToken: tokens?.accessToken,
        accessExpiresAt: tokens?.expirationTime,
        refreshToken: tokens?.refreshToken,
        apiKey: user?.apiKey,
        userId: user?.uid,
      };
    }
    return { signedOut: true };
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

/**
 * Runs inside a gumloop.com page (MAIN world). Makes the same three reads as
 * Gumloop's Credit Usage page, from the page's own origin, with the page's
 * current Firebase token. Returns status codes and parsed JSON only.
 * It must stay self-contained.
 */
export async function fetchGumloopRepliesInPage(
  expectedOrigin: string,
  apiOrigin: string,
  accessToken: string,
  userId: string,
  timeoutMs: number,
): Promise<unknown> {
  if (globalThis.location.origin !== expectedOrigin) return undefined;
  const get = async (path: string) => {
    try {
      const response = await fetch(`${apiOrigin}${path}`, {
        method: "GET",
        credentials: "omit",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "x-auth-key": userId,
        },
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      const retryAfter = response.headers.get("retry-after");
      return {
        status: response.status,
        ...(body === undefined ? {} : { body }),
        ...(retryAfter === null ? {} : { retryAfter }),
      };
    } catch {
      return { status: 0 };
    }
  };
  const project = await get("/project");
  let organizationId: string | undefined;
  if (project.status === 200 && Array.isArray(project.body)) {
    for (const entry of project.body as Array<{ organization_id?: unknown }>) {
      const id = entry?.organization_id;
      if (typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id.trim())) {
        organizationId = id.trim();
        break;
      }
    }
  }
  // Return only the organization ids, not the rest of the project list.
  const projectReply =
    project.status === 200 && Array.isArray(project.body)
      ? {
          ...project,
          body: (project.body as Array<{ organization_id?: unknown }>).map(
            (entry) => ({ organization_id: entry?.organization_id }),
          ),
        }
      : { status: project.status };
  if (!organizationId) return { project: projectReply };
  const base = `/organization/${encodeURIComponent(organizationId)}`;
  const [remaining, subscription] = await Promise.all([
    get(`${base}/credits`),
    get(`${base}/subscription`),
  ]);
  return { project: projectReply, remaining, subscription };
}

function nonEmpty(value: unknown, max = 8_192): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

/** Validates the injected result; page script output is untrusted. */
export function parseGumloopPageSession(
  value: unknown,
): GumloopPageSession | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.signedOut === true) return { signedOut: true };
  const accessToken = nonEmpty(record.accessToken);
  const refreshToken = nonEmpty(record.refreshToken);
  const apiKey = nonEmpty(record.apiKey, 256);
  const userId = nonEmpty(record.userId, 256);
  const expires = record.accessExpiresAt;
  const accessExpiresAt =
    typeof expires === "number" && Number.isFinite(expires) && expires > 0
      ? expires
      : undefined;
  if (!userId || (!accessToken && !refreshToken)) return undefined;
  return {
    userId,
    ...(accessToken ? { accessToken } : {}),
    ...(accessExpiresAt !== undefined ? { accessExpiresAt } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

function parseReply(value: unknown) {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (typeof status !== "number" || !Number.isInteger(status)) return undefined;
  const retryAfter =
    typeof record.retryAfter === "string" ? record.retryAfter : undefined;
  return {
    status,
    ...("body" in record ? { body: record.body } : {}),
    ...(retryAfter === undefined ? {} : { retryAfter }),
  };
}

/** Validates the replies a page returned; page script output is untrusted. */
export function parseGumloopPageReplies(value: unknown) {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const project = parseReply(record.project);
  if (!project) return undefined;
  const remaining = parseReply(record.remaining);
  const subscription = parseReply(record.subscription);
  return {
    project,
    ...(remaining ? { remaining } : {}),
    ...(subscription ? { subscription } : {}),
  };
}
