import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ProviderInstanceRecord } from "../domain/model";
import {
  clearLiveSession,
  collectWithSavedSession,
  parkLiveSession,
  type CookiesApi,
  type SavedSessionEnvironment,
  type SavedSessionSpec,
} from "./saved-session";
import { readSavedSession, saveSession } from "../storage/saved-sessions";
import type { CollectionResult, ProviderRuntimeServices } from "./types";

const A = "cursor:00000000-0000-4000-8000-00000000000a" as const;
const B = "cursor:00000000-0000-4000-8000-00000000000b" as const;
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

function cookie(
  name: string,
  value: string,
  domain = "cursor.com",
): Browser.cookies.Cookie {
  return {
    name,
    value,
    domain,
    path: "/",
    hostOnly: true,
    httpOnly: true,
    secure: true,
    session: false,
    sameSite: "lax",
    storeId: "0",
    expirationDate: 4_000_000_000,
  };
}

function fakeCookies(initial: Browser.cookies.Cookie[]) {
  let jar = [...initial];
  const api: CookiesApi & { jar(): Browser.cookies.Cookie[] } = {
    getAll: vi.fn(async ({ domain }: { domain: string }) =>
      jar.filter((entry) => entry.domain.replace(/^\./, "").endsWith(domain)),
    ),
    remove: vi.fn(async ({ name }: { url: string; name: string }) => {
      jar = jar.filter((entry) => entry.name !== name);
      return {};
    }),
    jar: () => jar,
  };
  return api;
}

function environment(api: CookiesApi | undefined) {
  const rules: Browser.declarativeNetRequest.Rule[][] = [];
  const updateSessionRules = vi.fn(
    async (options: {
      removeRuleIds?: number[];
      addRules?: Browser.declarativeNetRequest.Rule[];
    }) => {
      if (options.addRules) rules.push(options.addRules);
    },
  );
  const env: SavedSessionEnvironment = {
    cookies: async () => api,
    rules: { updateSessionRules },
    extensionHost: () => "extension-id",
  };
  return { env, rules, updateSessionRules };
}

function spec(liveKey: () => string | undefined): SavedSessionSpec {
  return {
    kind: "cursor",
    siteUrl: "https://cursor.com/",
    cookieDomain: "cursor.com",
    signInUrl: "https://cursor.com/dashboard",
    ruleId: 2,
    isAuthCookie: (name) => name === "Session",
    isSessionCookie: (name) => name === "Session",
    isDeviceCookie: (name) => name === "cf_clearance",
    liveAccountKey: vi.fn(async () => liveKey()),
  };
}

function instance(id: typeof A | typeof B, accountKey?: string): ProviderInstanceRecord {
  return {
    id,
    providerKind: "cursor",
    config: { kind: "fixed" },
    access: "granted",
    createdAt: 1,
    history: [],
    ...(accountKey ? { accountKey } : {}),
  };
}

function success(accountKey: string): CollectionResult {
  return {
    ok: true,
    snapshot: {
      providerKind: "cursor",
      accountKey,
      source: "web-session",
      fetchedAt: 5,
      metrics: [],
    },
  };
}

const services: ProviderRuntimeServices = {
  fetch: vi.fn(async () => new Response("{}")),
  now: 1_000,
  signal: new AbortController().signal,
  interaction: "forbidden",
};

beforeEach(async () => {
  await browser.storage.local.clear();
  vi.mocked(services.fetch).mockClear();
});

describe("collectWithSavedSession", () => {
  test("does not create a saved copy for a connection that never had one", async () => {
    const api = fakeCookies([cookie("Session", "live-a")]);
    await collectWithSavedSession({
      spec: spec(() => KEY_A),
      instance: instance(A, KEY_A),
      services,
      live: async () => success(KEY_A),
      saved: vi.fn(),
      environment: environment(api).env,
    });
    await expect(readSavedSession(A)).resolves.toBeUndefined();
  });

  test("reads live and refreshes the saved copy when the browser is on this account", async () => {
    await saveSession(A, [{ name: "Session", value: "old-a" }], 1);
    const api = fakeCookies([
      cookie("Session", "live-a"),
      { ...cookie("_ga", "analytics"), httpOnly: false },
    ]);
    const { env } = environment(api);
    const live = vi.fn(async () => success(KEY_A));
    const saved = vi.fn();

    const result = await collectWithSavedSession({
      spec: spec(() => KEY_A),
      instance: instance(A, KEY_A),
      services,
      live,
      saved,
      environment: env,
    });

    expect(result).toEqual(success(KEY_A));
    expect(saved).not.toHaveBeenCalled();
    await expect(readSavedSession(A)).resolves.toEqual({
      cookies: [{ name: "Session", value: "live-a", expirationDate: 4_000_000_000 }],
      savedAt: 1_000,
    });
  });

  test("never saves the browser's sign-in for a connection of another account", async () => {
    const api = fakeCookies([cookie("Session", "live-b")]);
    const { env } = environment(api);

    await collectWithSavedSession({
      spec: spec(() => KEY_B),
      instance: instance(A, KEY_A),
      services,
      live: async () => success(KEY_B),
      saved: vi.fn(),
      environment: env,
    });

    await expect(readSavedSession(A)).resolves.toBeUndefined();
  });

  test("reads with the saved sign-in through a one-request rule when the browser is elsewhere", async () => {
    await saveSession(A, [{ name: "Session", value: "saved-a" }], 1);
    const api = fakeCookies([
      cookie("Session", "live-b"),
      cookie("cf_clearance", "device"),
      cookie("workos_id", "b-identity"),
    ]);
    const { env, rules, updateSessionRules } = environment(api);
    const live = vi.fn();
    let ruleDuringRequest: Browser.declarativeNetRequest.Rule | undefined;
    let credentials: RequestCredentials | undefined;

    const result = await collectWithSavedSession({
      spec: spec(() => KEY_B),
      instance: instance(A, KEY_A),
      services: {
        ...services,
        fetch: vi.fn(async (_input, init) => {
          ruleDuringRequest = rules.at(-1)?.[0];
          credentials = init?.credentials;
          return new Response("{}");
        }),
      },
      live,
      saved: async (fetch) => {
        await fetch("https://cursor.com/api/usage-summary", {
          credentials: "include",
        });
        return success(KEY_A);
      },
      environment: env,
    });

    expect(result).toEqual(success(KEY_A));
    expect(live).not.toHaveBeenCalled();
    expect(credentials).toBe("omit");
    expect(ruleDuringRequest).toEqual({
      id: 2,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "cookie",
            operation: "set",
            value: "Session=saved-a; cf_clearance=device",
          },
        ],
        responseHeaders: [{ header: "set-cookie", operation: "remove" }],
      },
      condition: {
        requestDomains: ["cursor.com"],
        resourceTypes: ["xmlhttprequest"],
        initiatorDomains: ["extension-id"],
        tabIds: [-1],
      },
    });
    // The rule is removed again after the request.
    expect(updateSessionRules).toHaveBeenLastCalledWith({ removeRuleIds: [2] });
    // The browser's own sign-in is untouched.
    expect(api.jar().map(({ name }) => name)).toContain("Session");
  });

  test("drops a saved sign-in whose session cookie is gone", async () => {
    await saveSession(A, [{ name: "_account", value: "workspace" }], 1);
    const live = vi.fn(async () => success(KEY_B));
    await collectWithSavedSession({
      spec: spec(() => KEY_B),
      instance: instance(A, KEY_A),
      services,
      live,
      saved: vi.fn(),
      environment: environment(fakeCookies([])).env,
    });
    expect(live).toHaveBeenCalled();
    await expect(readSavedSession(A)).resolves.toBeUndefined();
  });

  test("does not park for a connection removed meanwhile", async () => {
    const api = fakeCookies([cookie("Session", "live-a")]);
    await expect(
      parkLiveSession(
        spec(() => KEY_A),
        [instance(A, KEY_A)],
        services,
        environment(api).env,
        async () => false,
      ),
    ).resolves.toBe("new_login");
    await expect(readSavedSession(A)).resolves.toBeUndefined();
    expect(api.jar()).toHaveLength(1);
  });

  test("removes the rule even when the request fails", async () => {
    await saveSession(A, [{ name: "Session", value: "saved-a" }], 1);
    const { env, updateSessionRules } = environment(fakeCookies([]));
    await expect(
      collectWithSavedSession({
        spec: spec(() => KEY_B),
        instance: instance(A, KEY_A),
        services: {
          ...services,
          fetch: vi.fn(async () => {
            throw new Error("network");
          }),
        },
        live: vi.fn(),
        saved: async (fetch) => {
          await fetch("https://cursor.com/api/usage-summary");
          return success(KEY_A);
        },
        environment: env,
      }),
    ).rejects.toThrow("network");
    expect(updateSessionRules).toHaveBeenLastCalledWith({ removeRuleIds: [2] });
  });

  test("does not refresh the copy if the browser switched account during the read", async () => {
    await saveSession(A, [{ name: "Session", value: "old-a" }], 1);
    const api = fakeCookies([cookie("Session", "live-b")]);
    let calls = 0;
    await collectWithSavedSession({
      // A at the start, B by the time the cookie is captured.
      spec: spec(() => (calls++ === 0 ? KEY_A : KEY_B)),
      instance: instance(A, KEY_A),
      services,
      live: async () => success(KEY_A),
      saved: vi.fn(),
      environment: environment(api).env,
    });
    await expect(readSavedSession(A)).resolves.toMatchObject({
      cookies: [{ name: "Session", value: "old-a" }],
    });
  });

  test("keeps a saved sign-in through a signed-out answer", async () => {
    await saveSession(A, [{ name: "Session", value: "saved-a" }], 1);
    const { env } = environment(fakeCookies([]));

    const result = await collectWithSavedSession({
      spec: spec(() => undefined),
      instance: instance(A, KEY_A),
      services,
      live: vi.fn(),
      saved: async () => ({ ok: false, health: { kind: "signed_out" } }),
      environment: env,
    });

    expect(result).toEqual({ ok: false, health: { kind: "signed_out" } });
    await expect(readSavedSession(A)).resolves.toBeDefined();
  });

  test("is exactly the live read without a saved sign-in or the cookies permission", async () => {
    await saveSession(A, [{ name: "Session", value: "saved-a" }], 1);
    const { env } = environment(undefined);
    const live = vi.fn(async () => success(KEY_B));

    // Unbound connections never use a saved sign-in.
    await collectWithSavedSession({
      spec: spec(() => KEY_B),
      instance: instance(A),
      services,
      live,
      saved: vi.fn(),
      environment: env,
    });
    expect(live).toHaveBeenCalledTimes(1);
  });

  test("runs reads of one site one at a time", async () => {
    await saveSession(A, [{ name: "Session", value: "saved-a" }], 1);
    const { env } = environment(fakeCookies([]));
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = collectWithSavedSession({
      spec: spec(() => KEY_B),
      instance: instance(A, KEY_A),
      services,
      live: vi.fn(),
      saved: async () => {
        order.push("first:start");
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push("first:end");
        return success(KEY_A);
      },
      environment: env,
    });
    const second = collectWithSavedSession({
      spec: spec(() => KEY_B),
      instance: instance(B, KEY_B),
      services,
      live: async () => {
        order.push("second");
        return success(KEY_B);
      },
      saved: vi.fn(),
      environment: env,
    });
    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });
});

describe("parkLiveSession", () => {
  test("saves the browser's sign-in for its connection, then signs the browser out locally", async () => {
    const api = fakeCookies([cookie("Session", "live-a"), cookie("cf_clearance", "device")]);
    const { env } = environment(api);

    await expect(
      parkLiveSession(spec(() => KEY_A), [instance(A, KEY_A)], services, env),
    ).resolves.toBe("parked");

    await expect(readSavedSession(A)).resolves.toMatchObject({
      cookies: [{ name: "Session", value: "live-a" }],
    });
    expect(api.jar().map(({ name }) => name)).toEqual(["cf_clearance"]);
  });

  test("saves and clears every HttpOnly sign-in cookie, keeping bot protection and page cookies", async () => {
    const api = fakeCookies([
      cookie("Session", "live-a"),
      cookie("restore-session", "sealed-a"),
      cookie("cf_clearance", "device"),
      { ...cookie("_ga", "analytics"), httpOnly: false },
    ]);
    const { env } = environment(api);

    await expect(
      parkLiveSession(spec(() => KEY_A), [instance(A, KEY_A)], services, env),
    ).resolves.toBe("parked");

    await expect(readSavedSession(A)).resolves.toMatchObject({
      cookies: [
        { name: "Session", value: "live-a" },
        { name: "restore-session", value: "sealed-a" },
      ],
    });
    expect(api.jar().map(({ name }) => name).sort()).toEqual(["_ga", "cf_clearance"]);
  });

  test("leaves a sign-in too large to save whole in the browser", async () => {
    const extra = Array.from({ length: 40 }, (_, index) =>
      cookie(`extra-${index}`, "sealed"),
    );
    const api = fakeCookies([cookie("Session", "live-a"), ...extra]);
    const { env } = environment(api);

    await expect(
      parkLiveSession(spec(() => KEY_A), [instance(A, KEY_A)], services, env),
    ).resolves.toBe("unavailable");

    await expect(readSavedSession(A)).resolves.toBeUndefined();
    expect(api.jar()).toHaveLength(41);
  });

  test("leaves a sign-in with a cookie it cannot save in the browser", async () => {
    const api = fakeCookies([
      cookie("Session", "live-a"),
      cookie("restore-session", '"quoted value"'),
    ]);
    const { env } = environment(api);

    await expect(
      parkLiveSession(spec(() => KEY_A), [instance(A, KEY_A)], services, env),
    ).resolves.toBe("unavailable");

    await expect(readSavedSession(A)).resolves.toBeUndefined();
    expect(api.jar()).toHaveLength(2);
  });

  test("leaves a sign-in no connection owns alone, so the new connection takes it", async () => {
    const api = fakeCookies([cookie("Session", "live-b")]);
    const { env } = environment(api);

    await expect(
      parkLiveSession(spec(() => KEY_B), [instance(A, KEY_A)], services, env),
    ).resolves.toBe("new_login");
    expect(api.jar()).toHaveLength(1);
  });

  test("reports a signed-out browser and a missing permission", async () => {
    await expect(
      parkLiveSession(
        spec(() => undefined),
        [instance(A, KEY_A)],
        services,
        environment(fakeCookies([])).env,
      ),
    ).resolves.toBe("signed_out");
    await expect(
      parkLiveSession(
        spec(() => KEY_A),
        [instance(A, KEY_A)],
        services,
        environment(undefined).env,
      ),
    ).resolves.toBe("unavailable");
  });

  test("removes sign-in cookies on subdomains with their own host", async () => {
    const api = fakeCookies([cookie("Session", "x", ".www.cursor.com")]);
    await clearLiveSession(spec(() => undefined), api);
    expect(api.remove).toHaveBeenCalledWith({
      url: "https://www.cursor.com/",
      name: "Session",
      storeId: "0",
    });
  });
});
