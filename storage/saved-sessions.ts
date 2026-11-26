import { isProviderInstanceId, type ProviderInstanceId } from "../domain/model";

// Saved browser sign-ins, one per connection, for providers whose usage can
// only be read with a web session (Cursor, ChatGPT). They let a connection
// keep refreshing after the browser signs in to another account. They live in
// storage.local, which the background restricts to trusted extension
// contexts (see initializeCredentialVault), and never leave the device except
// as the Cookie header of AI Limits' own usage requests to that provider.

export const SAVED_SESSION_STORAGE_KEY = "aiLimitsSavedSessions";
const MAX_COOKIES = 32;
const MAX_COOKIE_NAME_LENGTH = 128;
const MAX_COOKIE_VALUE_LENGTH = 8_192;

export interface SavedSessionCookie {
  name: string;
  value: string;
  /** Epoch seconds, as the cookies API reports it; absent for session cookies. */
  expirationDate?: number;
}

export interface SavedSession {
  cookies: SavedSessionCookie[];
  savedAt: number;
}

interface SavedSessionState {
  version: 1;
  sessions: Record<ProviderInstanceId, SavedSession>;
}

let mutationQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Cookie names are RFC 6265 tokens; values are cookie-octets. Anything else
// could break or inject into the Cookie header, so it is dropped.
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;

function normalizeCookie(value: unknown): SavedSessionCookie | undefined {
  if (!isRecord(value)) return undefined;
  const { name, value: cookieValue, expirationDate } = value;
  if (
    typeof name !== "string" ||
    typeof cookieValue !== "string" ||
    name.length === 0 ||
    name.length > MAX_COOKIE_NAME_LENGTH ||
    cookieValue.length === 0 ||
    cookieValue.length > MAX_COOKIE_VALUE_LENGTH ||
    !COOKIE_NAME.test(name) ||
    !COOKIE_VALUE.test(cookieValue)
  ) {
    return undefined;
  }
  return {
    name,
    value: cookieValue,
    ...(typeof expirationDate === "number" && Number.isFinite(expirationDate)
      ? { expirationDate }
      : {}),
  };
}

export function normalizeSavedSession(value: unknown): SavedSession | undefined {
  if (!isRecord(value) || !Array.isArray(value.cookies)) return undefined;
  if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)) {
    return undefined;
  }
  const cookies = value.cookies
    .slice(0, MAX_COOKIES)
    .map(normalizeCookie)
    .filter((cookie): cookie is SavedSessionCookie => cookie !== undefined);
  return cookies.length > 0 ? { cookies, savedAt: value.savedAt } : undefined;
}

function normalizeState(value: unknown): SavedSessionState {
  const state: SavedSessionState = { version: 1, sessions: {} };
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.sessions)) {
    return state;
  }
  for (const [instanceId, candidate] of Object.entries(value.sessions)) {
    if (!isProviderInstanceId(instanceId)) continue;
    const session = normalizeSavedSession(candidate);
    if (session) state.sessions[instanceId] = session;
  }
  return state;
}

async function readState(): Promise<SavedSessionState> {
  const stored = await browser.storage.local.get(SAVED_SESSION_STORAGE_KEY);
  return normalizeState(stored[SAVED_SESSION_STORAGE_KEY]);
}

function enqueue<T>(mutation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(mutation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** A saved session whose cookies have not all expired, or undefined. */
export async function readSavedSession(
  instanceId: ProviderInstanceId,
  nowMs: number = Date.now(),
): Promise<SavedSession | undefined> {
  const session = (await readState()).sessions[instanceId];
  if (!session) return undefined;
  const live = session.cookies.filter(
    ({ expirationDate }) =>
      expirationDate === undefined || expirationDate * 1000 > nowMs,
  );
  if (live.length === 0) {
    // An expired sign-in can never be used again, so it is not kept.
    await deleteSavedSession(instanceId);
    return undefined;
  }
  return { ...session, cookies: live };
}

function sameCookies(
  left: readonly SavedSessionCookie[],
  right: readonly SavedSessionCookie[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (cookie, index) =>
        cookie.name === right[index]?.name &&
        cookie.value === right[index]?.value,
    )
  );
}

/** Saves the session unless the same cookies are already saved. */
export function saveSession(
  instanceId: ProviderInstanceId,
  cookies: readonly SavedSessionCookie[],
  savedAt: number,
  { onlyIfSaved = false }: { onlyIfSaved?: boolean } = {},
): Promise<void> {
  const session = normalizeSavedSession({ cookies, savedAt });
  if (!isProviderInstanceId(instanceId) || !session) return Promise.resolve();
  return enqueue(async () => {
    const state = await readState();
    const current = state.sessions[instanceId];
    if (onlyIfSaved && !current) return;
    if (current && sameCookies(current.cookies, session.cookies)) return;
    await browser.storage.local.set({
      [SAVED_SESSION_STORAGE_KEY]: {
        ...state,
        sessions: { ...state.sessions, [instanceId]: session },
      },
    });
  });
}

export function deleteSavedSession(
  instanceId: ProviderInstanceId,
): Promise<void> {
  return enqueue(async () => {
    const state = await readState();
    if (!state.sessions[instanceId]) return;
    const sessions = { ...state.sessions };
    delete sessions[instanceId];
    await browser.storage.local.set({
      [SAVED_SESSION_STORAGE_KEY]: { ...state, sessions },
    });
  });
}

export function deleteAllSavedSessions(): Promise<void> {
  return enqueue(() => browser.storage.local.remove(SAVED_SESSION_STORAGE_KEY));
}

export async function hasSavedSessions(): Promise<boolean> {
  return Object.keys((await readState()).sessions).length > 0;
}
