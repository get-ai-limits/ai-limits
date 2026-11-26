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
  test("reads live and saves a fresh copy when the browser is on this account", async () => {
    const api = fakeCookies([cookie("Session", "live-a"), cookie("other", "x")]);
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

  test("forgets a saved sign-in the site no longer accepts", async () => {
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
    await expect(readSavedSession(A)).resolves.toBeUndefined();
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
