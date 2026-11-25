import { normalizeFixedConfig } from "../package-factories";
import { providerDefinitions } from "../definitions";
import {
  cleanupAbandonedOwnedTabs,
  openOwnedBackgroundTab,
  releaseOwnedBackgroundTab,
  type ListenerCleanup,
  type RemovedListener,
  type StorageSessionLike,
  type UpdatedListener,
} from "../tab-ensure";
import type {
  CollectionResult,
  ProviderPackage,
  ProviderRuntimeServices,
} from "../types";
import {
  fetchGumloopReplies,
  GUMLOOP_API_ORIGIN,
  gumloopOutcomeFromReplies,
  type GumloopOutcome,
  type GumloopReplies,
  type GumloopSessionCredentials,
} from "./adapter";
import {
  fetchGumloopRepliesInPage,
  GUMLOOP_ORIGIN,
  parseGumloopPageReplies,
  parseGumloopPageSession,
  readGumloopPageSessionAtExpectedOrigin,
  type GumloopPageSession,
} from "./page-session";
import {
  createGumloopSessionHolder,
  GUMLOOP_ACCESS_EXPIRY_MARGIN_MS,
  type GumloopCredentialLookup,
  type GumloopSessionHolder,
} from "./session";

export const GUMLOOP_OWNED_TAB_URL = `${GUMLOOP_ORIGIN}/settings/profile/general`;
export const GUMLOOP_OWNED_TAB_LEASE_PREFIX = "gumloopSessionTabLease";
// One deadline covers opening the inactive tab and reading its session.
export const GUMLOOP_OWNED_TAB_TIMEOUT_MS = 15_000;
const GUMLOOP_OWNED_READ_POLL_MS = 250;
// Each page call gets a bound of its own, so a frozen or slow tab cannot
// hold a refresh, or an owned tab, open past these.
export const GUMLOOP_PAGE_READ_TIMEOUT_MS = 3_000;
export const GUMLOOP_PAGE_FETCH_TIMEOUT_MS = 8_000;
const PAGE_CALL_TIMED_OUT = Symbol("gumloop-page-call-timed-out");

/** Resolves to the call's value, or a marker once the time or signal ends. */
function boundedPageCall<T>(
  call: () => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T | typeof PAGE_CALL_TIMED_OUT> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | typeof PAGE_CALL_TIMED_OUT) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(PAGE_CALL_TIMED_OUT);
    const timer = setTimeout(onAbort, Math.max(0, timeoutMs));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    let started: Promise<T>;
    try {
      started = call();
    } catch {
      onAbort();
      return;
    }
    started.then(finish, onAbort);
  });
}

export interface GumloopOwnedTab {
  tabId: number;
  deadline: number;
  release(): void;
}

export interface GumloopPackageDependencies {
  holder: GumloopSessionHolder;
  /** Open gumloop.com tabs; empty when page access is not granted. */
  openTabIds(): Promise<number[]>;
  /** Raw result of the session read in one tab; untrusted. */
  readPageSession(tabId: number): Promise<unknown>;
  /** Raw result of the usage reads run inside one tab; untrusted. */
  fetchInPage(
    tabId: number,
    credentials: GumloopSessionCredentials,
  ): Promise<unknown>;
  fetchReplies?: typeof fetchGumloopReplies;
  /** Connect and manual Refresh only: one inactive gumloop.com tab. */
  openOwnedTab?(signal: AbortSignal): Promise<GumloopOwnedTab | undefined>;
  cleanupAbandonedOwnedTab?(): Promise<void>;
  now?(): number;
  delay?(ms: number): Promise<void>;
}

interface PageRead {
  tabId: number;
  session: GumloopPageSession;
}

function freshPageCredentials(
  session: GumloopPageSession,
  now: number,
): GumloopSessionCredentials | undefined {
  if (
    !session.accessToken ||
    !session.userId ||
    session.accessExpiresAt === undefined ||
    session.accessExpiresAt - GUMLOOP_ACCESS_EXPIRY_MARGIN_MS <= now
  ) {
    return undefined;
  }
  return { accessToken: session.accessToken, userId: session.userId };
}

export function createGumloopPackage(
  dependencies: GumloopPackageDependencies,
): ProviderPackage {
  const now = dependencies.now ?? Date.now;
  const delay =
    dependencies.delay ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const fetchReplies = dependencies.fetchReplies ?? fetchGumloopReplies;

  const readTab = async (
    tabId: number,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<GumloopPageSession | undefined> => {
    const raw = await boundedPageCall(
      // A tab may close, navigate, or sleep while it is read.
      () => dependencies.readPageSession(tabId).catch(() => undefined),
      timeoutMs,
      signal,
    );
    return raw === PAGE_CALL_TIMED_OUT ? undefined : parseGumloopPageSession(raw);
  };

  /** Holds what a read found; a signed-out read drops the held session. */
  const remember = async (read: PageRead, startedIn: number) => {
    await dependencies.holder
      .rememberPageSession(read.session, startedIn)
      .catch(() => undefined);
  };

  const readOpenTabs = async (
    signal: AbortSignal,
  ): Promise<PageRead | undefined> => {
    let tabIds: number[];
    try {
      tabIds = await dependencies.openTabIds();
    } catch {
      return undefined;
    }
    const startedIn = dependencies.holder.beginPageRead();
    let signedOut: PageRead | undefined;
    for (const tabId of tabIds) {
      if (signal.aborted) break;
      const session = await readTab(tabId, GUMLOOP_PAGE_READ_TIMEOUT_MS, signal);
      if (!session) continue;
      if (!session.signedOut) {
        const read = { tabId, session };
        await remember(read, startedIn);
        return read;
      }
      signedOut ??= { tabId, session };
    }
    // Only a sign-out that no other open tab contradicts drops the session.
    if (signedOut) await remember(signedOut, startedIn);
    return signedOut;
  };

  const readOwnedTab = async (
    owned: GumloopOwnedTab,
    signal: AbortSignal,
  ): Promise<PageRead | undefined> => {
    const startedIn = dependencies.holder.beginPageRead();
    // The page's sign-in storage is ready once Firebase has started.
    while (!signal.aborted && now() < owned.deadline) {
      const session = await readTab(
        owned.tabId,
        Math.min(GUMLOOP_PAGE_READ_TIMEOUT_MS, owned.deadline - now()),
        signal,
      );
      if (session) {
        const read = { tabId: owned.tabId, session };
        await remember(read, startedIn);
        return read;
      }
      await delay(
        Math.min(GUMLOOP_OWNED_READ_POLL_MS, Math.max(0, owned.deadline - now())),
      );
    }
    return undefined;
  };

  const inBackground = async (
    credentials: GumloopSessionCredentials,
    services: ProviderRuntimeServices,
  ): Promise<GumloopOutcome> => {
    let replies: GumloopReplies | undefined;
    try {
      replies = await fetchReplies({
        fetch: services.fetch,
        credentials,
        signal: services.signal,
      });
    } catch {
      replies = undefined;
    }
    return replies
      ? gumloopOutcomeFromReplies(replies, services.now)
      : { kind: "unreachable" };
  };

  const inPage = async (
    tabId: number,
    credentials: GumloopSessionCredentials,
    services: ProviderRuntimeServices,
  ): Promise<GumloopOutcome> => {
    const raw = await boundedPageCall(
      () =>
        dependencies.fetchInPage(tabId, credentials).catch(() => undefined),
      GUMLOOP_PAGE_FETCH_TIMEOUT_MS,
      services.signal,
    );
    if (raw === PAGE_CALL_TIMED_OUT) return { kind: "unreachable" };
    const replies = parseGumloopPageReplies(raw);
    return replies
      ? gumloopOutcomeFromReplies(replies, services.now)
      : { kind: "unreachable" };
  };

  const collect = async (
    services: ProviderRuntimeServices,
  ): Promise<CollectionResult> => {
    const interactive = services.interaction === "allowed";
    let owned: GumloopOwnedTab | undefined;
    try {
      let page = await readOpenTabs(services.signal);
      const lookup = async (): Promise<GumloopCredentialLookup> => {
        const fromPage = page && freshPageCredentials(page.session, now());
        return fromPage
          ? { kind: "credentials", credentials: fromPage }
          : dependencies.holder.credentialsFor(undefined, services.signal);
      };
      let found = page?.session.signedOut ? undefined : await lookup();
      // Open a tab only for an interactive refresh that has nothing else:
      // no open gumloop.com page and no usable held session.
      if (
        !page &&
        found?.kind !== "credentials" &&
        found?.kind !== "rejected" &&
        interactive &&
        dependencies.openOwnedTab &&
        !services.signal.aborted
      ) {
        owned = await dependencies
          .openOwnedTab(services.signal)
          .catch(() => undefined);
        if (owned) {
          page = await readOwnedTab(owned, services.signal);
          if (page && !page.session.signedOut) found = await lookup();
        }
      }
      if (services.signal.aborted) {
        return { ok: false, health: { kind: "temporary_error" } };
      }
      if (page?.session.signedOut || found?.kind === "rejected") {
        return { ok: false, health: { kind: "signed_out" } };
      }
      if (!found || found.kind !== "credentials") {
        if (found?.kind === "unavailable") {
          return { ok: false, health: { kind: "temporary_error" } };
        }
        // No session to use, and nothing says the user signed out.
        return interactive
          ? {
              ok: false,
              health: { kind: "temporary_error", guidance: "retry_session" },
            }
          : { ok: false, deferred: { reason: "session_required" } };
      }
      let credentials = found.credentials;

      let outcome = await inBackground(credentials, services);
      if (outcome.kind === "auth_rejected" && !services.signal.aborted) {
        const renewed = await dependencies.holder.credentialsFor(
          credentials.accessToken,
          services.signal,
        );
        if (renewed.kind === "credentials") {
          credentials = renewed.credentials;
          outcome = await inBackground(credentials, services);
        } else if (renewed.kind === "rejected") {
          return { ok: false, health: { kind: "signed_out" } };
        }
      }
      // Gumloop may refuse requests that do not come from its own site. An
      // open gumloop.com page can make the same reads from its own origin.
      if (
        (outcome.kind === "unreachable" || outcome.kind === "auth_rejected") &&
        page &&
        !services.signal.aborted
      ) {
        outcome = await inPage(page.tabId, credentials, services);
      }

      switch (outcome.kind) {
        case "snapshot":
          return { ok: true, snapshot: outcome.snapshot };
        case "auth_rejected":
          return { ok: false, health: { kind: "signed_out" } };
        case "unreachable":
          return { ok: false, health: { kind: "temporary_error" } };
        case "failed":
          return { ok: false, health: outcome.health };
      }
    } finally {
      owned?.release();
    }
  };

  return {
    kind: "gumloop",
    cardinality: providerDefinitions.gumloop.cardinality,
    credentialKind: providerDefinitions.gumloop.credentialKind,
    configKind: providerDefinitions.gumloop.configKind,
    failureGuidance: {
      retry_session:
        "Could not read your Gumloop sign-in. Open gumloop.com, make sure you are signed in, then press Refresh.",
    },
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions: (config) =>
      normalizeFixedConfig(config)
        ? {
            origins: [...providerDefinitions.gumloop.optionalOrigins],
            permissions: [...providerDefinitions.gumloop.optionalPermissions],
          }
        : undefined,
    async startup(): Promise<void> {
      try {
        await dependencies.cleanupAbandonedOwnedTab?.();
      } catch {
        // Startup cleanup must never block background registration.
      }
    },
    async forgetSession(): Promise<void> {
      await dependencies.holder.forget();
    },
    async collect(instance, services): Promise<CollectionResult> {
      if (
        instance.providerKind !== "gumloop" ||
        !normalizeFixedConfig(instance.config)
      ) {
        return { ok: false, health: { kind: "provider_changed" } };
      }
      if (services.signal.aborted) {
        return { ok: false, health: { kind: "temporary_error" } };
      }
      return collect(services);
    },
  };
}

function productionDependencies(): GumloopPackageDependencies {
  // Resolve browser APIs lazily: the package is built at import time.
  const storageSession: StorageSessionLike = {
    get: (key) => browser.storage.session.get(key),
    set: (items) => browser.storage.session.set(items),
    remove: (key) => browser.storage.session.remove(key),
  };
  const holder = createGumloopSessionHolder({
    storage: storageSession,
    fetch: (input, init) => globalThis.fetch(input, init),
  });
  const tabs = {
    createTab: (details: { url: string; active: false }) =>
      browser.tabs.create(details),
    getTab: (tabId: number) => browser.tabs.get(tabId),
    removeTab: (tabId: number) => browser.tabs.remove(tabId),
    addUpdatedListener: (listener: UpdatedListener): ListenerCleanup => {
      browser.tabs.onUpdated.addListener(listener);
      return () => browser.tabs.onUpdated.removeListener(listener);
    },
    addRemovedListener: (listener: RemovedListener): ListenerCleanup => {
      browser.tabs.onRemoved.addListener(listener);
      return () => browser.tabs.onRemoved.removeListener(listener);
    },
    storageSession,
  };
  const remainsOnOwnedUrl = (url: string | undefined) =>
    url === GUMLOOP_OWNED_TAB_URL ||
    url?.startsWith(`${GUMLOOP_ORIGIN}/`) === true;

  return {
    holder,
    async openTabIds() {
      const granted = await browser.permissions
        .contains({
          origins: [...providerDefinitions.gumloop.optionalOrigins],
          permissions: [...providerDefinitions.gumloop.optionalPermissions],
        })
        .catch(() => false);
      if (!granted) return [];
      const found = await browser.tabs.query({ url: `${GUMLOOP_ORIGIN}/*` });
      return found.flatMap((tab) =>
        // Incognito tabs have their own sign-in; skip them.
        tab.id === undefined || tab.discarded || tab.incognito ? [] : [tab.id],
      );
    },
    async readPageSession(tabId) {
      const injected = await browser.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        injectImmediately: true,
        func: readGumloopPageSessionAtExpectedOrigin,
        args: [GUMLOOP_ORIGIN],
      });
      return injected[0]?.result;
    },
    async fetchInPage(tabId, credentials) {
      const injected = await browser.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        injectImmediately: true,
        func: fetchGumloopRepliesInPage,
        args: [
          GUMLOOP_ORIGIN,
          GUMLOOP_API_ORIGIN,
          credentials.accessToken,
          credentials.userId,
          GUMLOOP_PAGE_FETCH_TIMEOUT_MS - 1_000,
        ],
      });
      return injected[0]?.result;
    },
    async openOwnedTab(signal) {
      const deadline = Date.now() + GUMLOOP_OWNED_TAB_TIMEOUT_MS;
      const owned = await openOwnedBackgroundTab({
        url: GUMLOOP_OWNED_TAB_URL,
        leaseKeyPrefix: GUMLOOP_OWNED_TAB_LEASE_PREFIX,
        deadline,
        readyWhen: (tab) =>
          (tab.pendingUrl === undefined || tab.pendingUrl === "") &&
          tab.url !== undefined &&
          tab.url.startsWith(`${GUMLOOP_ORIGIN}/`),
        signal,
        ...tabs,
      });
      if (!owned) return undefined;
      return {
        tabId: owned.tabId,
        deadline,
        release: () =>
          releaseOwnedBackgroundTab({
            tabId: owned.tabId,
            leaseKey: owned.leaseKey,
            removeTab: tabs.removeTab,
            storageSession,
          }),
      };
    },
    cleanupAbandonedOwnedTab: () =>
      cleanupAbandonedOwnedTabs({
        storageSession,
        getTab: tabs.getTab,
        removeTab: tabs.removeTab,
        leaseKeyPrefix: GUMLOOP_OWNED_TAB_LEASE_PREFIX,
        remainsOnOwnedUrl,
      }),
  };
}

export const gumloopPackage = createGumloopPackage(productionDependencies());
