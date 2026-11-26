import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ProviderInstanceRecord } from "../domain/model";
import { cursorSavedSession } from "../providers/saved-session-specs";
import {
  AWAITING_SIGN_IN_WINDOW_MS,
  createSignInWatcher,
  markAwaitingSignIn,
  waitsForSignIn,
} from "./saved-session-sign-in";

const ID = "cursor:00000000-0000-4000-8000-00000000000a" as const;

function waiting(): ProviderInstanceRecord {
  return {
    id: ID,
    providerKind: "cursor",
    config: { kind: "fixed" },
    access: "granted",
    createdAt: 1,
    history: [],
  };
}

function setup(now = 1_000) {
  const timers: (() => void)[] = [];
  const refreshInstance = vi.fn(async () => undefined);
  const watcher = createSignInWatcher({
    specs: [cursorSavedSession],
    listInstances: async () => [waiting()],
    refreshInstance,
    now: () => now,
    setTimer: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  const flush = async () => {
    timers.splice(0).forEach((run) => run());
    await vi.waitFor(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { watcher, refreshInstance, flush };
}

const signInCookie = {
  removed: false,
  cookie: { name: "WorkosCursorSessionToken", domain: "cursor.com" },
};

beforeEach(async () => {
  await browser.storage.session.clear();
});

describe("sign-in watcher", () => {
  test("reads a waiting connection once its sign-in cookie lands", async () => {
    await markAwaitingSignIn("cursor", 1_000);
    const { watcher, refreshInstance, flush } = setup();

    watcher(signInCookie);
    await flush();

    expect(refreshInstance).toHaveBeenCalledTimes(1);
  });

  test("ignores sign-ins nobody waits for, removals, and unrelated cookies", async () => {
    const { watcher, refreshInstance, flush } = setup();
    watcher(signInCookie);
    await flush();
    expect(refreshInstance).not.toHaveBeenCalled();

    await markAwaitingSignIn("cursor", 1_000);
    watcher({ ...signInCookie, removed: true });
    watcher({ removed: false, cookie: { name: "_ga", domain: "cursor.com" } });
    watcher({
      removed: false,
      cookie: { name: "WorkosCursorSessionToken", domain: "example.com" },
    });
    await flush();
    expect(refreshInstance).not.toHaveBeenCalled();
  });

  test("stops watching once the window ends", async () => {
    await markAwaitingSignIn("cursor", 1_000);
    const { watcher, refreshInstance, flush } = setup(
      1_000 + AWAITING_SIGN_IN_WINDOW_MS,
    );
    watcher(signInCookie);
    await flush();
    expect(refreshInstance).not.toHaveBeenCalled();
  });

  test("waits only on untied, signed-out, or other-account connections", () => {
    expect(waitsForSignIn(waiting())).toBe(true);
    const bound = { ...waiting(), accountKey: "a".repeat(64) };
    expect(waitsForSignIn(bound)).toBe(false);
    expect(
      waitsForSignIn({
        ...bound,
        lastAttempt: {
          trigger: "scheduled",
          startedAt: 1,
          finishedAt: 2,
          outcome: { kind: "failure", category: "signed_out" },
        },
      }),
    ).toBe(true);
    expect(waitsForSignIn({ ...waiting(), access: "required" })).toBe(false);
  });
});
