export const CURSOR_OWNED_TAB_URL = "https://cursor.com/dashboard/spending";
export const CURSOR_OWNED_TAB_LEASE_PREFIX = "cursorDashboardTabLease";
export const CURSOR_OWNED_TAB_TIMEOUT_MS = 10_000;

export interface CursorDashboardJson {
  readonly grok?: unknown;
  readonly credits?: unknown;
  readonly aggregated?: unknown;
}

export type CursorDashboardEndpointResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status?: number };

export type CursorDashboardProbe =
  | { readonly kind: "no_tab" }
  | { readonly kind: "permission_missing" }
  | { readonly kind: "inject_threw"; readonly detail: string }
  | { readonly kind: "inject_empty"; readonly detail: string }
  | { readonly kind: "inject_unusable"; readonly detail: string }
  | { readonly kind: "wrong_origin"; readonly origin: string }
  | { readonly kind: "tab_asleep" }
  | {
      readonly kind: "read";
      readonly grok: CursorDashboardEndpointResult;
      readonly credits: CursorDashboardEndpointResult;
      readonly aggregated: CursorDashboardEndpointResult;
    };

interface CursorTab {
  id?: number;
  url?: string;
  discarded?: boolean;
  /** Chrome 132+ reports a frozen background tab, which runs no script. */
  frozen?: boolean;
  status?: string;
}

interface CursorScriptResult {
  result?: unknown;
}

type InjectedDashboardFunc =
  | typeof readCursorDashboardJsonAtExpectedOrigin
  | typeof startCursorDashboardStashAtExpectedOrigin
  | typeof readCursorDashboardStashAtExpectedOrigin
  | typeof clearCursorDashboardStashAtExpectedOrigin;

interface CursorDashboardBridge {
  hasPagePermission(): Promise<boolean>;
  queryTabs(details: { url: string }): Promise<CursorTab[]>;
  executeScript(details: {
    target: { tabId: number };
    world: "MAIN";
    func: InjectedDashboardFunc;
    /** Set for the owned tab, which may still be loading. */
    injectImmediately?: boolean;
  }): Promise<CursorScriptResult[]>;
  now?(): number;
  delay?(ms: number): Promise<void>;
  openOwnedTab?(): Promise<
    | {
        tabId: number;
        release: () => void;
        /** Shared create-wait-read deadline (epoch ms); the read ends by it. */
        deadline?: number;
      }
    | undefined
  >;
  /**
   * Whether a failed direct read may retry through the page-global stash.
   * Defaults to true; scheduled reads turn it off so an abandoned read can
   * never touch a stash another read is using.
   */
  stashFallback?: boolean;
  /** Stops trying further tabs once aborted. */
  signal?: AbortSignal;
  /** Caps an owned-tab read that has no shared deadline; tests shorten it. */
  ownedReadBudgetMs?: number;
}

/**
 * The owned tab is handed off while it may still be loading, so its read is
 * bounded too: a document that never settles must not keep the refresh
 * pending or the tab open. The read ends by the deadline the tab was opened
 * with; this cap applies only when none is given.
 */
export const CURSOR_OWNED_READ_BUDGET_MS = CURSOR_OWNED_TAB_TIMEOUT_MS;

const EXPECTED_ORIGIN = "https://cursor.com";

/**
 * Whether a freshly opened owned tab has committed a cursor.com document.
 * The dashboard POSTs only need a same-origin page, so the read need not
 * wait for the tab's load event: slow third-party resources on the dashboard
 * can hold that back past the owned-tab deadline (issue #63).
 */
export function cursorOwnedTabCommitted(tab: {
  url?: string;
  pendingUrl?: string;
}): boolean {
  if (tab.pendingUrl !== undefined && tab.pendingUrl !== "") return false;
  if (tab.url === undefined) return false;
  try {
    return new URL(tab.url).origin === EXPECTED_ORIGIN;
  } catch {
    return false;
  }
}

function asEndpointResult(value: unknown): CursorDashboardEndpointResult {
  if (value === undefined) return { ok: false };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false };
  }
  const record = value as { ok?: unknown; value?: unknown; status?: unknown };
  if (record.ok === true) return { ok: true, value: record.value };
  if (record.ok === false) {
    return typeof record.status === "number" &&
      Number.isInteger(record.status) &&
      record.status >= 100 &&
      record.status <= 599
      ? { ok: false, status: record.status }
      : { ok: false };
  }
  return { ok: true, value };
}

export function tabLooksAsleep(tab: CursorTab): boolean {
  if (tab.discarded === true || tab.frozen === true) return true;
  return tab.status !== undefined && tab.status !== "complete";
}

export function rankCursorTabs(tabs: readonly CursorTab[]): number[] {
  return tabs
    .flatMap((tab) =>
      tab.id === undefined
        ? []
        : [{ id: tab.id, url: tab.url, asleep: tabLooksAsleep(tab) }],
    )
    .sort((left, right) => {
      const pathDelta = cursorTabScore(left.url) - cursorTabScore(right.url);
      if (pathDelta !== 0) return pathDelta;
      return Number(left.asleep) - Number(right.asleep);
    })
    .map((tab) => tab.id);
}

function cursorTabScore(url: string | undefined): number {
  if (url === undefined) return 4;
  try {
    const path = new URL(url).pathname;
    if (path === "/dashboard/spending" || path.startsWith("/dashboard/spending/")) {
      return 0;
    }
    if (path === "/dashboard" || path.startsWith("/dashboard/")) return 1;
    if (path === "/settings" || path.startsWith("/settings/")) return 2;
    if (path === "/" || path === "") return 4;
    return 3;
  } catch {
    return 5;
  }
}

export async function readCursorDashboardJsonAtExpectedOrigin(
  fetchPage: typeof globalThis.fetch = globalThis.fetch,
  currentOrigin: string = globalThis.location.origin,
): Promise<
  | {
      readonly grok: CursorDashboardEndpointResult;
      readonly credits: CursorDashboardEndpointResult;
      readonly aggregated: CursorDashboardEndpointResult;
    }
  | { readonly declined: "wrong_origin"; readonly origin: string }
> {
  if (currentOrigin !== EXPECTED_ORIGIN) {
    return { declined: "wrong_origin", origin: currentOrigin };
  }

  const readJson = async (url: string): Promise<CursorDashboardEndpointResult> => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 8_000);
    try {
      const response = await fetchPage(url, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: abortController.signal,
      });
      if (!response.ok) return { ok: false, status: response.status };
      return { ok: true, value: await response.json() };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // These POSTs must stay same-origin. A service-worker fetch is rejected
  // with 403 "Invalid origin for state-changing request".
  const [grok, credits, aggregated] = await Promise.all([
    readJson("https://cursor.com/api/dashboard/get-sand-usage-status"),
    readJson("https://cursor.com/api/dashboard/get-credit-grants-balance"),
    readJson("https://cursor.com/api/dashboard/get-aggregated-usage-events"),
  ]);
  return { grok, credits, aggregated };
}

/** The query parameter that tags a saved account's page requests. */
export const SAVED_READ_MARKER = "ai-limits-read";

/**
 * Runs in a cursor.com page for a connection that is not the browser's
 * account. Every request carries the one-time `marker`, which the saved
 * sign-in rule matches, so the page's own requests are left alone. It first
 * asks which account the requests are signed in to, so the caller can check
 * it is the connection's; only that ID's `sub` and the three dashboard
 * answers leave the page.
 */
export async function readCursorDashboardJsonAsSavedAccount(
  marker: string,
): Promise<
  | {
      readonly sub?: string;
      readonly grok: CursorDashboardEndpointResult;
      readonly credits: CursorDashboardEndpointResult;
      readonly aggregated: CursorDashboardEndpointResult;
    }
  | { readonly declined: "wrong_origin"; readonly origin: string }
> {
  const origin = globalThis.location.origin;
  if (origin !== "https://cursor.com") {
    return { declined: "wrong_origin", origin };
  }
  const tagged = (path: string) =>
    `https://cursor.com${path}?ai-limits-read=${encodeURIComponent(marker)}`;
  // Short limits keep the whole read well inside the refresh deadline, so
  // it ends (and its rule is removed) before the base usage read starts.
  const request = async (
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<CursorDashboardEndpointResult> => {
    try {
      // `omit`: only the saved sign-in rule supplies cookies, so a request
      // that misses the rule is signed out, never the browser's account.
      const response = await globalThis.fetch(tagged(path), {
        ...init,
        credentials: "omit",
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return { ok: false, status: response.status };
      return { ok: true, value: await response.json() };
    } catch {
      return { ok: false };
    }
  };
  const me = await request("/api/auth/me", { method: "GET" }, 3_000);
  const body = me.ok ? me.value : undefined;
  const sub =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).sub
      : undefined;
  if (typeof sub !== "string" || sub.length === 0) {
    return { grok: { ok: false }, credits: { ok: false }, aggregated: { ok: false } };
  }
  const post: RequestInit = {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: "{}",
  };
  const [grok, credits, aggregated] = await Promise.all([
    request("/api/dashboard/get-sand-usage-status", post, 5_000),
    request("/api/dashboard/get-credit-grants-balance", post, 5_000),
    request("/api/dashboard/get-aggregated-usage-events", post, 5_000),
  ]);
  return { sub, grok, credits, aggregated };
}

/** Matches only requests tagged with `marker`. */
export function savedReadRegexFilter(marker: string): string {
  return `^https://cursor\\.com/api/(auth/me|dashboard/(get-sand-usage-status|get-credit-grants-balance|get-aggregated-usage-events))\\?${SAVED_READ_MARKER}=${marker}$`;
}

export interface SavedDashboardBridge {
  hasPagePermission(): Promise<boolean>;
  queryTabs(details: { url: string }): Promise<CursorTab[]>;
  executeScript(details: {
    target: { tabId: number };
    world: "MAIN";
    func: typeof readCursorDashboardJsonAsSavedAccount;
    args: [string];
  }): Promise<CursorScriptResult[]>;
  /** Runs the read while the tab's tagged requests carry the saved sign-in. */
  inTab<T>(tabId: number, regexFilter: string, operation: () => Promise<T>): Promise<T>;
  /** Whether the `sub` the page reported is the connection's account. */
  isConnectionAccount(sub: string): Promise<boolean>;
  /** A fresh marker; letters and digits only. */
  marker(): string;
}

/** One tab, so the read stays within about eight seconds. */
const SAVED_READ_TABS = 1;

/**
 * The page's own timeouts only run while the page runs script, so a tab that
 * is frozen or held by a dialog could keep the read, its tab rule, and the
 * Cursor lock waiting. The read gives up after this, inside `inTab`, so the
 * rule is still removed while the lock is held.
 */
export const SAVED_READ_TIMEOUT_MS = 9_000;

function withinSavedReadTime<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("saved read timed out")),
      SAVED_READ_TIMEOUT_MS,
    );
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Reads the dashboard JSON for a connection the browser is not signed in to,
 * from an already-open cursor.com tab, with that connection's saved sign-in
 * on the tagged requests only. Never opens a tab. Values count only when the
 * page reports the connection's own account.
 */
export async function readSavedCursorDashboard(
  bridge: SavedDashboardBridge,
): Promise<CursorDashboardProbe> {
  try {
    if (!(await bridge.hasPagePermission())) return { kind: "permission_missing" };
    const tabs = (await bridge.queryTabs({ url: "https://cursor.com/*" })).filter(
      (tab) => tab.id !== undefined,
    );
    if (tabs.length === 0) return { kind: "no_tab" };
    const awake = rankCursorTabs(tabs.filter((tab) => !tabLooksAsleep(tab)));
    if (awake.length === 0) return { kind: "tab_asleep" };
    let failure: CursorDashboardProbe = {
      kind: "inject_empty",
      detail: "no saved read produced a result",
    };
    for (const tabId of awake.slice(0, SAVED_READ_TABS)) {
      const marker = bridge.marker();
      if (!/^[A-Za-z0-9]{16,64}$/.test(marker)) {
        return { kind: "inject_unusable", detail: "invalid marker" };
      }
      let frames: CursorScriptResult[];
      try {
        frames = await bridge.inTab(tabId, savedReadRegexFilter(marker), () =>
          withinSavedReadTime(
            bridge.executeScript({
              target: { tabId },
              world: "MAIN",
              func: readCursorDashboardJsonAsSavedAccount,
              args: [marker],
            }),
          ),
        );
      } catch (error) {
        failure = { kind: "inject_threw", detail: sanitizeInjectDetail(error) };
        continue;
      }
      const value = Array.isArray(frames) ? frames[0]?.result : undefined;
      const wrongOrigin = asWrongOrigin(value);
      if (wrongOrigin) {
        failure = wrongOrigin;
        continue;
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        failure = { kind: "inject_empty", detail: "saved read returned nothing" };
        continue;
      }
      const sub = (value as { sub?: unknown }).sub;
      if (typeof sub !== "string") {
        failure = { kind: "inject_empty", detail: "saved read found no account" };
        continue;
      }
      if (!(await bridge.isConnectionAccount(sub))) {
        failure = { kind: "inject_unusable", detail: "saved read was another account" };
        continue;
      }
      const read = asReadResult(value);
      if (read) return read;
    }
    return failure;
  } catch (error) {
    return { kind: "inject_threw", detail: sanitizeInjectDetail(error) };
  }
}

export function startCursorDashboardStashAtExpectedOrigin(
  currentOrigin: string = globalThis.location.origin,
): { readonly started: true } | { readonly declined: "wrong_origin"; readonly origin: string } {
  if (currentOrigin !== "https://cursor.com") {
    return { declined: "wrong_origin", origin: currentOrigin };
  }
  const stashKey = "__aiLimitsCursorDashboardV1";
  const target = globalThis as typeof globalThis & Record<string, unknown>;
  target[stashKey] = { status: "pending" };
  const readJson = async (url: string): Promise<CursorDashboardEndpointResult> => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 8_000);
    try {
      const response = await globalThis.fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: abortController.signal,
      });
      if (!response.ok) return { ok: false, status: response.status };
      return { ok: true, value: await response.json() };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timeoutId);
    }
  };
  void Promise.all([
    readJson("https://cursor.com/api/dashboard/get-sand-usage-status"),
    readJson("https://cursor.com/api/dashboard/get-credit-grants-balance"),
    readJson("https://cursor.com/api/dashboard/get-aggregated-usage-events"),
  ])
    .then(([grok, credits, aggregated]) => {
      target[stashKey] = { status: "ready", grok, credits, aggregated };
    })
    .catch(() => {
      target[stashKey] = { status: "failed" };
    });
  return { started: true };
}

export function readCursorDashboardStashAtExpectedOrigin(): unknown {
  const stashKey = "__aiLimitsCursorDashboardV1";
  return (globalThis as typeof globalThis & Record<string, unknown>)[stashKey];
}

export function clearCursorDashboardStashAtExpectedOrigin(): { readonly cleared: true } {
  const stashKey = "__aiLimitsCursorDashboardV1";
  const target = globalThis as typeof globalThis & Record<string, unknown>;
  try {
    delete target[stashKey];
  } catch {
    target[stashKey] = undefined;
  }
  return { cleared: true };
}

export function dashboardJsonFromProbe(
  probe: CursorDashboardProbe,
): CursorDashboardJson {
  if (probe.kind !== "read") return {};
  return {
    ...(probe.grok.ok ? { grok: probe.grok.value } : {}),
    ...(probe["credits"].ok ? { credits: probe["credits"].value } : {}),
    ...(probe.aggregated.ok ? { aggregated: probe.aggregated.value } : {}),
  };
}

function asWrongOrigin(
  value: unknown,
): { readonly kind: "wrong_origin"; readonly origin: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as { declined?: unknown; origin?: unknown };
  if (record.declined !== "wrong_origin" || typeof record.origin !== "string") {
    return undefined;
  }
  const origin = record.origin.trim();
  if (origin.length === 0 || origin.length > 128) return undefined;
  return { kind: "wrong_origin", origin };
}

export function sanitizeInjectDetail(value: unknown): string {
  const text =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : Object.prototype.toString.call(value);
  const compact = text.replace(/\s+/g, " ").trim().slice(0, 160);
  return compact.length > 0 ? compact : "unknown";
}

export function isThenable(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function describeInjectedValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(length=${value.length})`;
  if (isThenable(value)) return `thenable typeof=${typeof value}`;
  return typeof value;
}

function asReadResult(value: unknown): Extract<CursorDashboardProbe, { kind: "read" }> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as {
    declined?: unknown;
    grok?: unknown;
    credits?: unknown;
    aggregated?: unknown;
  };
  if (record.declined !== undefined) return undefined;
  return {
    kind: "read",
    grok: asEndpointResult(record.grok),
    credits: asEndpointResult(record["credits"]),
    aggregated: asEndpointResult(record.aggregated),
  };
}

type InjectFailure = Extract<
  CursorDashboardProbe,
  { kind: "inject_threw" | "inject_empty" | "inject_unusable" }
>;

const STASH_BUDGET_MS = 8_000;
const STASH_POLL_MS = 200;

async function runInjected(
  executeScript: CursorDashboardBridge["executeScript"],
  tabId: number,
  func: InjectedDashboardFunc,
): Promise<
  | { readonly kind: "value"; readonly value: unknown }
  | InjectFailure
> {
  try {
    const frames = await executeScript({
      target: { tabId },
      world: "MAIN",
      func,
    });
    if (!Array.isArray(frames) || frames.length === 0) {
      return { kind: "inject_empty", detail: "executeScript returned no frames" };
    }
    if (!Object.hasOwn(frames[0] as object, "result") && frames[0]?.result === undefined) {
      return { kind: "inject_empty", detail: "injection.result was undefined" };
    }
    const result = frames[0]?.result;
    if (result === undefined) {
      return { kind: "inject_empty", detail: "injection.result was undefined" };
    }
    if (isThenable(result)) {
      return { kind: "inject_unusable", detail: describeInjectedValue(result) };
    }
    return { kind: "value", value: result };
  } catch (error) {
    return { kind: "inject_threw", detail: sanitizeInjectDetail(error) };
  }
}

async function readStashFallback(
  executeScript: CursorDashboardBridge["executeScript"],
  tabId: number,
  now: () => number,
  delay: (ms: number) => Promise<void>,
): Promise<
  | Extract<CursorDashboardProbe, { kind: "read" | "wrong_origin" }>
  | InjectFailure
> {
  const started = await runInjected(
    executeScript,
    tabId,
    startCursorDashboardStashAtExpectedOrigin,
  );
  if (started.kind !== "value") return started;
  const wrongOrigin = asWrongOrigin(started.value);
  if (wrongOrigin) return wrongOrigin;
  const startedRecord = started.value as { started?: unknown };
  if (startedRecord.started !== true) {
    return {
      kind: "inject_unusable",
      detail: `two-step start ${describeInjectedValue(started.value)}`,
    };
  }

  const deadline = now() + STASH_BUDGET_MS;
  try {
    while (now() < deadline) {
      await delay(STASH_POLL_MS);
      const polled = await runInjected(
        executeScript,
        tabId,
        readCursorDashboardStashAtExpectedOrigin,
      );
      if (polled.kind !== "value") return polled;
      if (polled.value === undefined || polled.value === null) continue;
      if (typeof polled.value !== "object" || Array.isArray(polled.value)) {
        return {
          kind: "inject_unusable",
          detail: `two-step stash ${describeInjectedValue(polled.value)}`,
        };
      }
      const stash = polled.value as {
        status?: unknown;
        grok?: unknown;
        credits?: unknown;
        aggregated?: unknown;
      };
      if (stash.status === "pending") continue;
      if (stash.status === "failed") {
        return { kind: "inject_empty", detail: "two-step stash failed" };
      }
      if (stash.status === "ready") {
        return {
          kind: "read",
          grok: asEndpointResult(stash.grok),
          credits: asEndpointResult(stash["credits"]),
          aggregated: asEndpointResult(stash.aggregated),
        };
      }
    }
    return { kind: "inject_empty", detail: "two-step stash timed out" };
  } finally {
    await runInjected(
      executeScript,
      tabId,
      clearCursorDashboardStashAtExpectedOrigin,
    );
  }
}

async function injectIntoTabIds(
  tabIds: readonly number[],
  executeScript: CursorDashboardBridge["executeScript"],
  now: () => number,
  delay: (ms: number) => Promise<void>,
  stashFallback = true,
  signal?: AbortSignal,
): Promise<{
  probe?: CursorDashboardProbe;
  lastWrongOrigin?: { kind: "wrong_origin"; origin: string };
  firstFailure?: InjectFailure;
}> {
  let lastWrongOrigin: { kind: "wrong_origin"; origin: string } | undefined;
  let firstFailure: InjectFailure | undefined;
  for (const tabId of tabIds) {
    if (signal?.aborted) break;
    const direct = await runInjected(
      executeScript,
      tabId,
      readCursorDashboardJsonAtExpectedOrigin,
    );
    if (direct.kind === "value") {
      const wrongOrigin = asWrongOrigin(direct.value);
      if (wrongOrigin) {
        lastWrongOrigin = wrongOrigin;
        continue;
      }
      if (!isThenable(direct.value)) {
        const read = asReadResult(direct.value);
        if (read) return { probe: read };
      }
      firstFailure ??= {
        kind: "inject_unusable",
        detail: describeInjectedValue(direct.value),
      };
    } else if (direct.kind === "inject_threw") {
      firstFailure ??= direct;
      continue;
    } else {
      firstFailure ??= direct;
    }

    if (!stashFallback || signal?.aborted) continue;
    const fallback = await readStashFallback(executeScript, tabId, now, delay);
    if (fallback.kind === "read") return { probe: fallback };
    if (fallback.kind === "wrong_origin") {
      lastWrongOrigin = fallback;
      continue;
    }
    firstFailure =
      fallback.detail.startsWith("two-step stash")
        ? fallback
        : (firstFailure ?? fallback);
  }
  return { lastWrongOrigin, firstFailure };
}

export async function findCursorDashboardJson({
  hasPagePermission,
  queryTabs,
  executeScript,
  now = Date.now,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  openOwnedTab,
  stashFallback = true,
  signal,
  ownedReadBudgetMs = CURSOR_OWNED_READ_BUDGET_MS,
}: CursorDashboardBridge): Promise<CursorDashboardProbe> {
  try {
    if (!(await hasPagePermission())) return { kind: "permission_missing" };
    const tabs = await queryTabs({ url: "https://cursor.com/*" });
    const candidates = tabs.filter((tab) => tab.id !== undefined);
    if (candidates.length === 0) {
      if (!openOwnedTab) return { kind: "no_tab" };
      const owned = await openOwnedTab();
      if (!owned) return { kind: "no_tab" };
      // The tab may still be loading. Inject right away rather than at
      // document_idle: the same-origin POSTs only need the committed
      // document, and idle can wait on the same slow resources as load.
      const ownedExecute: CursorDashboardBridge["executeScript"] = (details) =>
        executeScript({ ...details, injectImmediately: true });
      const budget = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<CursorDashboardProbe>((resolve) => {
        timer = setTimeout(() => {
          budget.abort();
          resolve({ kind: "inject_empty", detail: "owned tab read timed out" });
        }, owned.deadline === undefined
          ? ownedReadBudgetMs
          : Math.max(0, owned.deadline - Date.now()));
      });
      try {
        const read = injectIntoTabIds(
          [owned.tabId],
          ownedExecute,
          now,
          delay,
          true,
          budget.signal,
        ).then(
          (opened): CursorDashboardProbe =>
            opened.probe ??
            opened.lastWrongOrigin ??
            opened.firstFailure ?? { kind: "no_tab" },
        );
        return await Promise.race([read, timedOut]);
      } finally {
        clearTimeout(timer);
        budget.abort();
        owned.release();
      }
    }
    const onlyAsleep = candidates.every(tabLooksAsleep);
    const existing = await injectIntoTabIds(
      rankCursorTabs(candidates),
      executeScript,
      now,
      delay,
      stashFallback,
      signal,
    );
    if (existing.probe) return existing.probe;
    if (existing.lastWrongOrigin) return existing.lastWrongOrigin;
    if (onlyAsleep) return { kind: "tab_asleep" };
    return (
      existing.firstFailure ?? {
        kind: "inject_empty",
        detail: "no injection attempt produced a result",
      }
    );
  } catch (error) {
    return { kind: "inject_threw", detail: sanitizeInjectDetail(error) };
  }
}
