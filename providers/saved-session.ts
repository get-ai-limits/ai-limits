import type { ProviderInstanceRecord } from "../domain/model";
import type { ProviderKind } from "./catalog";
import type { CollectionResult, ProviderRuntimeServices } from "./types";
import { extensionOriginHost } from "./warp/origin-rule";
import {
  deleteSavedSession,
  normalizeSavedSession,
  readSavedSession,
  saveSession,
  type SavedSessionCookie,
} from "../storage/saved-sessions";

// Cursor and ChatGPT read usage only through the browser's sign-in, and a
// browser holds one sign-in per site. With the optional `cookies`
// permission, AI Limits saves each connection's sign-in cookies, so a
// connection keeps refreshing after the browser signs in to another account.
//
// A saved sign-in is replayed only on AI Limits' own background requests to
// that one site: a session rule sets their Cookie header and drops any
// Set-Cookie answer, so the browser's own sign-in and open tabs are never
// touched. The rule exists only for the length of one request, and every
// request to the site from the service worker runs under one lock, so a
// request for one account can never carry another account's sign-in.

export const SAVED_SESSION_PERMISSION = "cookies" as const;

export interface SavedSessionSpec {
  readonly kind: Extract<ProviderKind, "cursor" | "chatgpt">;
  /** The site's root, e.g. https://cursor.com/. */
  readonly siteUrl: string;
  /** The registrable domain the sign-in cookies are set on. */
  readonly cookieDomain: string;
  /** Where a new account signs in. */
  readonly signInUrl: string;
  /** DNR session rule id; unique per provider (Warp uses 1). */
  readonly ruleId: number;
  /** The cookies that carry the sign-in. */
  isAuthCookie(name: string): boolean;
  /**
   * The cookies that are the session itself; a saved sign-in without one
   * (only companions such as a workspace choice left) is spent.
   */
  isSessionCookie(name: string): boolean;
  /**
   * Cookies that belong to the browser rather than to an account (bot
   * protection), sent alongside a saved sign-in so the site accepts it.
   */
  isDeviceCookie(name: string): boolean;
  /** Which login the browser is signed in to now, as an opaque account key. */
  liveAccountKey(
    fetch: typeof globalThis.fetch,
    signal: AbortSignal,
  ): Promise<string | undefined>;
}

const CLOUDFLARE_COOKIES = new Set(["__cf_bm", "cf_clearance", "_cfuvid", "__cflb"]);

export function cloudflareCookie(name: string): boolean {
  return CLOUDFLARE_COOKIES.has(name);
}

export interface CookiesApi {
  getAll(details: { domain: string }): Promise<Browser.cookies.Cookie[]>;
  remove(details: { url: string; name: string; storeId?: string }): Promise<unknown>;
}

export interface SessionRulesApi {
  updateSessionRules(options: {
    removeRuleIds?: number[];
    addRules?: Browser.declarativeNetRequest.Rule[];
  }): Promise<void>;
}

export interface SavedSessionEnvironment {
  /** Undefined unless the optional cookies permission is granted. */
  cookies(): Promise<CookiesApi | undefined>;
  rules: SessionRulesApi;
  extensionHost(): string;
}

export const browserSavedSessionEnvironment: SavedSessionEnvironment = {
  async cookies() {
    try {
      const granted = await browser.permissions.contains({
        permissions: [SAVED_SESSION_PERMISSION],
      });
      const api = (browser as { cookies?: CookiesApi }).cookies;
      return granted && api ? api : undefined;
    } catch {
      return undefined;
    }
  },
  get rules() {
    return browser.declarativeNetRequest;
  },
  extensionHost: () => extensionOriginHost(),
};

function onDomain(cookie: Browser.cookies.Cookie, domain: string): boolean {
  const host = cookie.domain.replace(/^\./, "");
  return host === domain || host.endsWith(`.${domain}`);
}

async function siteCookies(
  spec: SavedSessionSpec,
  api: CookiesApi,
): Promise<Browser.cookies.Cookie[]> {
  const all = await api.getAll({ domain: spec.cookieDomain });
  return all.filter((cookie) => onDomain(cookie, spec.cookieDomain));
}

/**
 * Whether a cookie is part of the browser's sign-in to the site: the named
 * sign-in cookies, plus every other HttpOnly cookie the site sets that is not
 * bot protection. A site can keep a second, longer-lived sign-in cookie that
 * silently restores the named one (Cursor does: removing only its
 * `WorkosCursorSessionToken` signed the browser straight back in), so the
 * whole set is saved and cleared together.
 */
function isSignInCookie(
  spec: SavedSessionSpec,
  cookie: Pick<Browser.cookies.Cookie, "name" | "httpOnly">,
): boolean {
  if (spec.isAuthCookie(cookie.name)) return true;
  return cookie.httpOnly && !spec.isDeviceCookie(cookie.name);
}

/**
 * The browser's current sign-in cookies for the site, in a stable order: the
 * named sign-in cookies first, so storage's cookie cap never drops them.
 */
export async function captureLiveSession(
  spec: SavedSessionSpec,
  api: CookiesApi,
): Promise<SavedSessionCookie[]> {
  const rank = (name: string) => (spec.isAuthCookie(name) ? 0 : 1);
  const cookies = (await siteCookies(spec, api))
    .filter((cookie) => isSignInCookie(spec, cookie))
    .sort(
      (left, right) =>
        rank(left.name) - rank(right.name) ||
        left.name.localeCompare(right.name),
    );
  return cookies.map(({ name, value, expirationDate }) => ({
    name,
    value,
    ...(expirationDate === undefined ? {} : { expirationDate }),
  }));
}

/**
 * Signs the browser out of the site locally, without telling the site, so
 * the saved copy of the sign-in stays valid. The site's own Log out would end
 * the session on its servers and void every saved copy.
 */
export async function clearLiveSession(
  spec: SavedSessionSpec,
  api: CookiesApi,
  /** Only these exact cookies, so one the site rotated since is kept. */
  only?: readonly SavedSessionCookie[],
): Promise<void> {
  for (const cookie of await siteCookies(spec, api)) {
    if (!isSignInCookie(spec, cookie)) continue;
    if (
      only &&
      !only.some(
        ({ name, value }) => name === cookie.name && value === cookie.value,
      )
    ) {
      continue;
    }
    const host = cookie.domain.replace(/^\./, "");
    await api.remove({
      url: `https://${host}${cookie.path || "/"}`,
      name: cookie.name,
      ...(cookie.storeId ? { storeId: cookie.storeId } : {}),
    });
  }
}

function cookieHeader(
  saved: readonly SavedSessionCookie[],
  device: readonly Browser.cookies.Cookie[],
): string {
  return [...saved, ...device]
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}

function savedSessionRule(
  spec: SavedSessionSpec,
  extensionHost: string,
  header: string,
  origin: string | undefined,
): Browser.declarativeNetRequest.Rule {
  return {
    id: spec.ruleId,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "cookie", operation: "set", value: header },
        ...(origin === undefined
          ? []
          : [{ header: "origin", operation: "set", value: origin }]),
      ],
      responseHeaders: [{ header: "set-cookie", operation: "remove" }],
    },
    condition: {
      requestDomains: [spec.cookieDomain],
      resourceTypes: ["xmlhttprequest"],
      initiatorDomains: [extensionHost],
      // Service-worker requests have no tab, so pages are never matched.
      tabIds: [-1],
    },
  } as Browser.declarativeNetRequest.Rule;
}

export async function removeSavedSessionRule(
  spec: SavedSessionSpec,
  rules: SessionRulesApi,
): Promise<void> {
  await rules.updateSessionRules({ removeRuleIds: [spec.ruleId] });
}

/**
 * A fetch whose requests to the site carry the saved sign-in instead. With
 * `origin`, they also carry the site's own Origin, as a request from one of
 * its pages would. Requests run one at a time, since the rule is set for
 * exactly one request.
 */
function savedSessionFetch(
  spec: SavedSessionSpec,
  environment: SavedSessionEnvironment,
  baseFetch: typeof globalThis.fetch,
  header: string,
  origin?: string,
): typeof globalThis.fetch {
  let queue: Promise<unknown> = Promise.resolve();
  return (input, init) => {
    const run = async () => {
      const rule = savedSessionRule(
        spec,
        environment.extensionHost(),
        header,
        origin,
      );
      await environment.rules.updateSessionRules({
        removeRuleIds: [spec.ruleId],
        addRules: [rule],
      });
      try {
        // `omit` keeps the browser from storing anything the site answers.
        return await baseFetch(input, { ...init, credentials: "omit" });
      } finally {
        await removeSavedSessionRule(spec, environment.rules);
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };
}

const siteLocks = new Map<string, Promise<void>>();

/** Runs every service-worker request to one site in turn. */
export async function withSiteLock<T>(
  spec: SavedSessionSpec,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = (siteLocks.get(spec.kind) ?? Promise.resolve()).catch(
    () => undefined,
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  siteLocks.set(spec.kind, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (siteLocks.get(spec.kind) === tail) siteLocks.delete(spec.kind);
  }
}

export interface SavedSessionCollectOptions {
  spec: SavedSessionSpec;
  instance: ProviderInstanceRecord;
  services: ProviderRuntimeServices;
  /** Reads with the browser's own sign-in. */
  live(): Promise<CollectionResult>;
  /**
   * Reads with the given fetch, which carries the saved sign-in.
   * `pageFetch` also carries the site's own Origin, for requests the site
   * accepts only from its pages.
   */
  saved(
    fetch: typeof globalThis.fetch,
    pageFetch: typeof globalThis.fetch,
  ): Promise<CollectionResult>;
  environment?: SavedSessionEnvironment;
}

/**
 * Reads a connection with the browser's sign-in when the browser is signed in
 * to that connection's account (saving a fresh copy of it), and with its saved
 * sign-in otherwise. Without the cookies permission or a saved sign-in this is
 * exactly the live read.
 */
export async function collectWithSavedSession({
  spec,
  instance,
  services,
  live,
  saved,
  environment = browserSavedSessionEnvironment,
}: SavedSessionCollectOptions): Promise<CollectionResult> {
  return withSiteLock(spec, async () => {
    // A rule left behind by a stopped service worker must never reach a live
    // read.
    await removeSavedSessionRule(spec, environment.rules).catch(() => undefined);
    let savedSession = instance.accountKey
      ? await readSavedSession(instance.id, services.now)
      : undefined;
    if (
      savedSession &&
      !savedSession.cookies.some(({ name }) => spec.isSessionCookie(name))
    ) {
      await deleteSavedSession(instance.id);
      savedSession = undefined;
    }
    if (instance.accountKey && savedSession) {
      const liveKey = await spec.liveAccountKey(services.fetch, services.signal);
      if (liveKey !== instance.accountKey) {
        const api = await environment.cookies();
        const device = api
          ? (await siteCookies(spec, api).catch(() => [])).filter(({ name }) =>
              spec.isDeviceCookie(name),
            )
          : [];
        const header = cookieHeader(savedSession.cookies, device);
        const result = await saved(
          savedSessionFetch(spec, environment, services.fetch, header),
          savedSessionFetch(
            spec,
            environment,
            services.fetch,
            header,
            new URL(spec.siteUrl).origin,
          ),
        );
        // A signed-out answer is kept, not deleted: it may be a brief or
        // replay-specific failure, and the browser is no longer signed in to
        // this account to recover it. Disconnect or expiry removes it.
        return result;
      }
    }
    const result = await live();
    // An existing saved copy is kept fresh here. A first copy is saved by
    // saveLiveSession, which only runs while the provider has another
    // connection.
    if (
      result.ok &&
      savedSession &&
      instance.accountKey !== undefined &&
      result.snapshot.accountKey === instance.accountKey
    ) {
      await refreshSavedCopy(spec, instance, services, environment);
    }
    return result;
  });
}

async function refreshSavedCopy(
  spec: SavedSessionSpec,
  instance: ProviderInstanceRecord,
  { fetch, signal, now }: Pick<ProviderRuntimeServices, "fetch" | "signal" | "now">,
  environment: SavedSessionEnvironment,
): Promise<void> {
  try {
    const api = await environment.cookies();
    if (!api) return;
    const cookies = await captureLiveSession(spec, api);
    // The browser could have switched account since the read; save only if
    // it is still on this connection's account.
    if (
      cookies.length === 0 ||
      (await spec.liveAccountKey(fetch, signal)) !== instance.accountKey
    ) {
      return;
    }
    // Only an existing copy is refreshed, so a read that finishes after its
    // connection was removed cannot bring a deleted sign-in back.
    await saveSession(instance.id, cookies, now, { onlyIfSaved: true });
  } catch {
    // Saving a copy is best effort; the reading itself already succeeded.
  }
}

/**
 * What storage keeps of a captured sign-in: the named sign-in cookies come
 * first, so a cookie left out (one storage cannot hold) is never the session
 * itself. Undefined when a named sign-in cookie (such as one chunk of a split
 * session token) cannot be kept, since the copy could not sign in.
 */
function savableSignIn(
  spec: SavedSessionSpec,
  captured: readonly SavedSessionCookie[],
  now: number,
): SavedSessionCookie[] | undefined {
  const cookies =
    normalizeSavedSession({ cookies: [...captured], savedAt: now })?.cookies ?? [];
  const kept = new Set(cookies.map(({ name }) => name));
  if (
    !cookies.some(({ name }) => spec.isSessionCookie(name)) ||
    captured.some(({ name }) => spec.isAuthCookie(name) && !kept.has(name))
  ) {
    return undefined;
  }
  return cookies;
}

/**
 * Saves the browser's sign-in for a connection that has none saved yet, while
 * the browser is signed in to that connection's account. Called only for a
 * provider with more than one connection, so every account added keeps
 * refreshing once the browser moves on, however it moves on. The browser's
 * sign-in is left as it is.
 */
export async function saveLiveSession(
  spec: SavedSessionSpec,
  instance: ProviderInstanceRecord,
  services: Pick<ProviderRuntimeServices, "fetch" | "signal" | "now">,
  environment: SavedSessionEnvironment = browserSavedSessionEnvironment,
  /** Whether the connection still exists; checked right before saving. */
  stillConnected: () => Promise<boolean> = async () => true,
): Promise<boolean> {
  if (instance.accountKey === undefined) return false;
  const api = await environment.cookies();
  if (!api) return false;
  return withSiteLock(spec, async () => {
    if (await readSavedSession(instance.id, services.now)) return false;
    const onAccount = async () =>
      (await spec.liveAccountKey(services.fetch, services.signal)) ===
      instance.accountKey;
    if (!(await onAccount())) return false;
    // Captured after that read, so a cookie its response rotated is saved at
    // its new value. Checked again after, so a browser that moved to another
    // account in between is never saved for this one.
    const captured = await captureLiveSession(spec, api);
    if (!(await onAccount())) return false;
    const cookies = savableSignIn(spec, captured, services.now);
    if (!cookies || !(await stillConnected())) return false;
    await saveSession(instance.id, cookies, services.now);
    // A connection removed while saving must not keep a copy.
    if (!(await stillConnected())) {
      await deleteSavedSession(instance.id);
      return false;
    }
    return true;
  });
}

export type ParkResult =
  /** Saving needs the cookies permission, which is not granted. */
  | "unavailable"
  /** The browser is not signed in to the site. */
  | "signed_out"
  /** The browser's sign-in belongs to no existing connection. */
  | "new_login"
  /** The sign-in was saved for its connection and the browser signed out. */
  | "parked";

/**
 * Makes room for another account: saves the browser's sign-in for the
 * connection it belongs to, then signs the browser out of the site locally.
 */
export async function parkLiveSession(
  spec: SavedSessionSpec,
  siblings: readonly ProviderInstanceRecord[],
  services: Pick<ProviderRuntimeServices, "fetch" | "signal" | "now">,
  environment: SavedSessionEnvironment = browserSavedSessionEnvironment,
  /** Whether the owning connection still exists; checked right before saving. */
  stillConnected: (owner: ProviderInstanceRecord) => Promise<boolean> = async () =>
    true,
): Promise<ParkResult> {
  const api = await environment.cookies();
  if (!api) return "unavailable";
  return withSiteLock(spec, async () => {
    await removeSavedSessionRule(spec, environment.rules).catch(() => undefined);
    const liveKey = await spec.liveAccountKey(services.fetch, services.signal);
    if (!liveKey) return "signed_out";
    const owner = siblings.find(({ accountKey }) => accountKey === liveKey);
    if (!owner) return "new_login";
    // Captured after that read, so a cookie its response rotated is saved
    // at its new value.
    const captured = await captureLiveSession(spec, api);
    // Signed in, but to cookies this extension cannot see or save.
    if (captured.length === 0) return "unavailable";
    // Only the kept cookies are cleared, so the browser loses nothing
    // unsaved.
    const cookies = savableSignIn(spec, captured, services.now);
    if (!cookies) return "unavailable";
    if (!(await stillConnected(owner))) return "new_login";
    await saveSession(owner.id, cookies, services.now);
    await clearLiveSession(spec, api, cookies);
    return "parked";
  });
}
