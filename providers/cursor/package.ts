import type { ProviderInstanceRecord } from "../../domain/model";
import { normalizeFixedConfig } from "../package-factories";
import type {
  CollectionContext,
  CollectionResult,
  ProviderPackage,
  ProviderRuntimeServices,
} from "../types";
import { providerDefinitions } from "../definitions";
import {
  cleanupAbandonedOwnedTabs,
  openOwnedBackgroundTab,
  releaseOwnedBackgroundTab,
  type ListenerCleanup,
  type RemovedListener,
  type UpdatedListener,
} from "../tab-ensure";
import { collectCursor } from "./adapter";
import {
  collectWithSavedSession,
  type SavedSessionEnvironment,
  type SavedSessionSpec,
} from "../saved-session";
import { cursorSavedSession } from "../saved-session-specs";
import { applyCursorPageMetrics } from "./page-metrics";
import {
  CURSOR_OWNED_TAB_LEASE_PREFIX,
  CURSOR_OWNED_TAB_TIMEOUT_MS,
  CURSOR_OWNED_TAB_URL,
  cursorOwnedTabCommitted,
  dashboardJsonFromProbe,
  findCursorDashboardJson,
  type CursorDashboardEndpointResult,
  type CursorDashboardJson,
  type CursorDashboardProbe,
} from "./page-dashboard";

interface CursorPackageDependencies {
  collect(
    context: CollectionContext,
    dashboard: CursorDashboardJson,
  ): Promise<CollectionResult>;
  /**
   * Reads the dashboard JSON through a cursor.com page. `allowOwnedTab` lets
   * it open one inactive tab when none is open; otherwise it only uses a tab
   * the user already has open.
   */
  findDashboardJson(options: {
    allowOwnedTab: boolean;
    /** Set on scheduled reads; aborts when the read is abandoned. */
    signal?: AbortSignal;
  }): Promise<CursorDashboardProbe>;
  cleanupAbandonedOwnedTab?(): Promise<void>;
  /** How long scheduled refresh waits for a page read; tests shorten it. */
  scheduledProbeBudgetMs?: number;
  /** Lets each connection keep its own saved sign-in. */
  savedSession?: SavedSessionSpec;
  savedSessionEnvironment?: SavedSessionEnvironment;
}

// Scheduled refresh shares the provider's collection deadline with the base
// usage request, so its optional page read gets a short budget of its own.
export const CURSOR_SCHEDULED_PROBE_BUDGET_MS = 8_000;

type ProbeOrSkipped = CursorDashboardProbe | { kind: "skipped" };

/** Resolves to `skipped` once the budget runs out or the signal aborts. */
function withinBudget(
  probe: Promise<CursorDashboardProbe>,
  budgetMs: number,
  signal: AbortSignal,
): Promise<ProbeOrSkipped> {
  return new Promise((resolve) => {
    const finish = (value: ProbeOrSkipped) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish({ kind: "skipped" });
    const timer = setTimeout(() => finish({ kind: "skipped" }), budgetMs);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    probe.then(finish, () =>
      finish({ kind: "inject_threw", detail: "findDashboardJson threw" }),
    );
  });
}

const GROK_ENDPOINT = "https://cursor.com/api/dashboard/get-sand-usage-status";
const CREDIT_GRANTS_ENDPOINT =
  "https://cursor.com/api/dashboard/get-credit-grants-balance";
const AGGREGATED_ENDPOINT =
  "https://cursor.com/api/dashboard/get-aggregated-usage-events";

/**
 * Reads the dashboard JSON a cursor.com page reads, with a saved sign-in, one
 * request at a time within `budgetMs`. `skipped` unless at least one answer
 * came back, so a refusal keeps the last page values and their wording.
 */
export async function readSavedDashboard(
  pageFetch: typeof globalThis.fetch,
  signal: AbortSignal,
  budgetMs: number,
): Promise<CursorDashboardProbe | { kind: "skipped" }> {
  const abort = new AbortController();
  const stop = () => abort.abort();
  const timer = setTimeout(stop, budgetMs);
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  const read = async (url: string): Promise<CursorDashboardEndpointResult> => {
    if (abort.signal.aborted) return { ok: false };
    try {
      const response = await pageFetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: abort.signal,
      });
      if (!response.ok) return { ok: false, status: response.status };
      return { ok: true, value: await response.json() };
    } catch {
      return { ok: false };
    }
  };
  try {
    const grok = await read(GROK_ENDPOINT);
    const credits = await read(CREDIT_GRANTS_ENDPOINT);
    const aggregated = await read(AGGREGATED_ENDPOINT);
    if (!grok.ok && !credits.ok && !aggregated.ok) return { kind: "skipped" };
    return { kind: "read", grok, credits, aggregated };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

function adapterContext(services: ProviderRuntimeServices): CollectionContext {
  return {
    fetch: services.fetch,
    now: services.now,
    signal: services.signal,
  };
}

function matchesCursor(instance: ProviderInstanceRecord): boolean {
  return (
    instance.providerKind === "cursor" &&
    normalizeFixedConfig(instance.config) !== undefined
  );
}

export function createCursorPackage(
  dependencies: CursorPackageDependencies,
): ProviderPackage {
  return {
    kind: "cursor",
    cardinality: providerDefinitions.cursor.cardinality,
    credentialKind: providerDefinitions.cursor.credentialKind,
    configKind: providerDefinitions.cursor.configKind,
    ...(dependencies.savedSession
      ? { savedSession: dependencies.savedSession }
      : {}),
    normalizeConfig: normalizeFixedConfig,
    requiredPermissions: (config) =>
      normalizeFixedConfig(config)
        ? {
            origins: [...providerDefinitions.cursor.optionalOrigins],
            permissions: [...providerDefinitions.cursor.optionalPermissions],
          }
        : undefined,
    async startup(): Promise<void> {
      try {
        await dependencies.cleanupAbandonedOwnedTab?.();
      } catch {
        // Startup cleanup must never block background registration.
      }
    },
    async collect(instance, services): Promise<CollectionResult> {
      if (!matchesCursor(instance)) {
        return { ok: false, health: { kind: "provider_changed" } };
      }

      const live = async (): Promise<CollectionResult> => {
        const interactive = services.interaction === "allowed";
        let probe: ProbeOrSkipped = { kind: "skipped" };
        if (interactive && !services.signal.aborted) {
          try {
            probe = await dependencies.findDashboardJson({ allowOwnedTab: true });
          } catch {
            probe = { kind: "inject_threw", detail: "findDashboardJson threw" };
          }
        } else if (!interactive && !services.signal.aborted) {
          // Stops the read itself, not just the wait, once it is abandoned.
          const abandon = new AbortController();
          let started: Promise<CursorDashboardProbe>;
          try {
            started = dependencies.findDashboardJson({
              allowOwnedTab: false,
              signal: abandon.signal,
            });
          } catch {
            started = Promise.reject(new Error("findDashboardJson threw"));
          }
          probe = await withinBudget(
            started,
            dependencies.scheduledProbeBudgetMs ??
              CURSOR_SCHEDULED_PROBE_BUDGET_MS,
            services.signal,
          );
          abandon.abort();
        }
        // Scheduled refresh only uses an already-open cursor.com tab, within a
        // short budget. Without a usable read it keeps the scheduled wording
        // (no tab hints) and last-good page values.
        if (!interactive && probe.kind !== "read") probe = { kind: "skipped" };
        const dashboard =
          probe.kind === "skipped" ? {} : dashboardJsonFromProbe(probe);
        const result = await dependencies.collect(
          adapterContext(services),
          dashboard,
        );
        return applyCursorPageMetrics(
          result,
          instance.snapshot,
          probe,
          services.now,
        );
      };
      if (!dependencies.savedSession) return live();
      return collectWithSavedSession({
        spec: dependencies.savedSession,
        instance,
        services,
        live,
        // A cursor.com tab reads as the browser's account, so this
        // connection's page values are read with its saved sign-in instead,
        // carrying cursor.com's Origin as the page would. If Cursor refuses
        // that, they are left as they were.
        saved: async (fetch, pageFetch) => {
          const probe = await readSavedDashboard(
            pageFetch,
            services.signal,
            dependencies.scheduledProbeBudgetMs ??
              CURSOR_SCHEDULED_PROBE_BUDGET_MS,
          );
          return applyCursorPageMetrics(
            await dependencies.collect(
              { ...adapterContext(services), fetch },
              probe.kind === "read" ? dashboardJsonFromProbe(probe) : {},
            ),
            instance.snapshot,
            probe,
            services.now,
          );
        },
        ...(dependencies.savedSessionEnvironment
          ? { environment: dependencies.savedSessionEnvironment }
          : {}),
      });
    },
  };
}

function cursorOwnedTabBrowser() {
  return {
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
    storageSession: browser.storage.session,
  };
}

export const cursorPackage = createCursorPackage({
  collect: collectCursor,
  savedSession: cursorSavedSession,
  findDashboardJson: ({ allowOwnedTab, signal }) => {
    const tabs = cursorOwnedTabBrowser();
    return findCursorDashboardJson({
      hasPagePermission: async () => {
        try {
          return Boolean(
            await browser.permissions.contains({
              origins: [...providerDefinitions.cursor.optionalOrigins],
              permissions: [...providerDefinitions.cursor.optionalPermissions],
            }),
          );
        } catch {
          return false;
        }
      },
      queryTabs: (details) => browser.tabs.query(details),
      executeScript: (details) => browser.scripting.executeScript(details),
      // Scheduled reads use only the direct read: no page-global stash.
      stashFallback: allowOwnedTab,
      signal,
      openOwnedTab: allowOwnedTab ? async () => {
        // One deadline covers opening the tab and reading it.
        const deadline = Date.now() + CURSOR_OWNED_TAB_TIMEOUT_MS;
        const owned = await openOwnedBackgroundTab({
          url: CURSOR_OWNED_TAB_URL,
          leaseKeyPrefix: CURSOR_OWNED_TAB_LEASE_PREFIX,
          deadline,
          readyWhen: cursorOwnedTabCommitted,
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
              storageSession: tabs.storageSession,
            }),
        };
      } : undefined,
    });
  },
  cleanupAbandonedOwnedTab: () => {
    const tabs = cursorOwnedTabBrowser();
    return cleanupAbandonedOwnedTabs({
      storageSession: tabs.storageSession,
      getTab: tabs.getTab,
      removeTab: tabs.removeTab,
      leaseKeyPrefix: CURSOR_OWNED_TAB_LEASE_PREFIX,
      remainsOnOwnedUrl: (url) =>
        url === CURSOR_OWNED_TAB_URL ||
        url?.startsWith(CURSOR_OWNED_TAB_URL) === true,
    });
  },
});
