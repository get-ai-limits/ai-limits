import type { ProviderInstanceRecord } from "../domain/model";
import type { ProviderKind } from "../providers/catalog";
import type { SavedSessionSpec } from "../providers/saved-session";

// After AI Limits opens a provider's sign-in page for another account, it
// watches for that sign-in's cookie and reads the waiting connection as soon
// as it lands, so nobody has to press Refresh. It watches only for a short
// while, so a site that rewrites its cookie on every visit does not trigger
// reads later on.

export const AWAITING_SIGN_IN_KEY = "savedSessionAwaitingSignIn";
export const AWAITING_SIGN_IN_WINDOW_MS = 15 * 60_000;
const SETTLE_MS = 1_500;

/** Provider kind to the time its sign-in watch ends. */
type AwaitingSignIn = { [providerKind: string]: number };

async function readAwaiting(): Promise<AwaitingSignIn> {
  try {
    const stored = await browser.storage.session.get(AWAITING_SIGN_IN_KEY);
    const value = stored[AWAITING_SIGN_IN_KEY];
    return typeof value === "object" && value !== null
      ? (value as AwaitingSignIn)
      : {};
  } catch {
    return {};
  }
}

export async function markAwaitingSignIn(
  kind: ProviderKind,
  now: number,
): Promise<void> {
  const awaiting = await readAwaiting();
  await browser.storage.session.set({
    [AWAITING_SIGN_IN_KEY]: { ...awaiting, [kind]: now + AWAITING_SIGN_IN_WINDOW_MS },
  });
}

async function isAwaitingSignIn(kind: ProviderKind, now: number): Promise<boolean> {
  const until = (await readAwaiting())[kind];
  return typeof until === "number" && until > now;
}

async function clearAwaitingSignIn(kind: ProviderKind): Promise<void> {
  const awaiting = await readAwaiting();
  if (!(kind in awaiting)) return;
  delete awaiting[kind];
  await browser.storage.session.set({ [AWAITING_SIGN_IN_KEY]: awaiting });
}

/** A connection that a new sign-in could complete. */
export function waitsForSignIn(instance: ProviderInstanceRecord): boolean {
  if (instance.access !== "granted") return false;
  if (instance.accountKey === undefined) return true;
  const outcome = instance.lastAttempt?.outcome;
  return (
    outcome?.kind === "failure" &&
    (outcome.category === "signed_out" || outcome.category === "other_account")
  );
}

interface CookieChange {
  removed: boolean;
  cookie: { name: string; domain: string };
}

export interface SignInWatcherOptions {
  specs: readonly SavedSessionSpec[];
  listInstances(): Promise<ProviderInstanceRecord[]>;
  refreshInstance(instance: ProviderInstanceRecord): Promise<unknown>;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/** Returns the cookies.onChanged listener that completes waiting sign-ins. */
export function createSignInWatcher({
  specs,
  listInstances,
  refreshInstance,
  now = Date.now,
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: SignInWatcherOptions): (change: CookieChange) => void {
  // Keyed by provider kind.
  const timers = new Map<string, unknown>();

  const complete = async (spec: SavedSessionSpec) => {
    if (!(await isAwaitingSignIn(spec.kind, now()))) return;
    const waiting = (await listInstances()).filter(
      (instance) => instance.providerKind === spec.kind && waitsForSignIn(instance),
    );
    for (const instance of waiting) {
      try {
        await refreshInstance(instance);
      } catch {
        // The next scheduled refresh reads it instead.
      }
    }
    const still = (await listInstances()).some(
      (instance) =>
        instance.providerKind === spec.kind &&
        instance.accountKey === undefined &&
        instance.access === "granted",
    );
    if (!still) await clearAwaitingSignIn(spec.kind);
  };

  return ({ removed, cookie }) => {
    if (removed) return;
    const host = cookie.domain.replace(/^\./, "");
    const spec = specs.find(
      ({ cookieDomain, isAuthCookie }) =>
        (host === cookieDomain || host.endsWith(`.${cookieDomain}`)) &&
        isAuthCookie(cookie.name),
    );
    if (!spec) return;
    // A sign-in sets several cookies in a row; read once they settle.
    const pending = timers.get(spec.kind);
    if (pending !== undefined) clearTimer(pending);
    timers.set(
      spec.kind,
      setTimer(() => {
        timers.delete(spec.kind);
        void complete(spec).catch(() => undefined);
      }, SETTLE_MS),
    );
  };
}
