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
  type GumloopSessionHolder,
} from "./session";

export const GUMLOOP_OWNED_TAB_URL = `${GUMLOOP_ORIGIN}/settings/profile/general`;
export const GUMLOOP_OWNED_TAB_LEASE_PREFIX = "gumloopSessionTabLease";
// One deadline covers opening the inactive tab and reading its session.
export const GUMLOOP_OWNED_TAB_TIMEOUT_MS = 15_000;
const GUMLOOP_OWNED_READ_POLL_MS = 250;

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
    startedIn: number,
  ): Promise<GumloopPageSession | undefined> => {
    let raw: unknown;
    try {
      raw = await dependencies.readPageSession(tabId);
    } catch {
      // A tab may close, navigate, or sleep while it is read.
      return undefined;
    }
    const session = parseGumloopPageSession(raw);
    if (session) {
      await dependencies.holder
        .rememberPageSession(session, startedIn)
        .catch(() => undefined);
    }
    return session;
  };

  const readOpenTabs = async (): Promise<PageRead | undefined> => {
    let tabIds: number[];
    try {
      tabIds = await dependencies.openTabIds();
    } catch {
      return undefined;
    }
    const startedIn = dependencies.holder.beginPageRead();
    let signedOut: PageRead | undefined;
    for (const tabId of tabIds) {
      const session = await readTab(tabId, startedIn);
      if (!session) continue;
      if (!session.signedOut) return { tabId, session };
      signedOut ??= { tabId, session };
    }
    return signedOut;
  };

  const readOwnedTab = async (
    owned: GumloopOwnedTab,
    signal: AbortSignal,
  ): Promise<PageRead | undefined> => {
    const startedIn = dependencies.holder.beginPageRead();
    // The page's sign-in storage is ready once Firebase has started.
    while (!signal.aborted && now() < owned.deadline) {
      const session = await readTab(owned.tabId, startedIn);
      if (session) return { tabId: owned.tabId, session };
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
    let raw: unknown;
    try {
      raw = await dependencies.fetchInPage(tabId, credentials);
    } catch {
      return { kind: "unreachable" };
    }
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
      let page = await readOpenTabs();
      if (!page && interactive && dependencies.openOwnedTab) {
        owned = await dependencies
          .openOwnedTab(services.signal)
          .catch(() => undefined);
        if (owned) page = await readOwnedTab(owned, services.signal);
      }
      if (services.signal.aborted) {
        return { ok: false, health: { kind: "temporary_error" } };
      }
      if (page?.session.signedOut) {
        return { ok: false, health: { kind: "signed_out" } };
      }

      let credentials =
        (page && freshPageCredentials(page.session, now())) ??
        (await dependencies.holder.credentialsFor(undefined, services.signal));
      if (!credentials) {
        return interactive
          ? { ok: false, health: { kind: "signed_out" } }
          : { ok: false, deferred: { reason: "session_required" } };
      }

      let outcome = await inBackground(credentials, services);
      if (outcome.kind === "auth_rejected" && !services.signal.aborted) {
        const renewed = await dependencies.holder.credentialsFor(
          credentials.accessToken,
          services.signal,
        );
        if (renewed) {
          credentials = renewed;
          outcome = await inBackground(credentials, services);
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
        tab.id === undefined || tab.discarded ? [] : [tab.id],
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
        func: fetchGumloopRepliesInPage,
        args: [
          GUMLOOP_ORIGIN,
          GUMLOOP_API_ORIGIN,
          credentials.accessToken,
          credentials.userId,
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
