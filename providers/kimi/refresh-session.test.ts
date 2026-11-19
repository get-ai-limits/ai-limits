import { describe, expect, test, vi } from "vitest";

import type { StorageSessionLike } from "../tab-ensure";
import {
  KIMI_ACCESS_EXPIRY_MARGIN_MS,
  KIMI_REFRESH_ENDPOINT,
  KIMI_REFRESH_SESSION_KEY,
  createKimiSessionHolder,
  exchangeKimiRefreshToken,
  kimiTokenExpiresAt,
  readKimiStoredSession,
  saveKimiStoredSession,
} from "./refresh-session";

function memoryStorage(initial: Record<string, unknown> = {}) {
  const items: Record<string, unknown> = { ...initial };
  const storage: StorageSessionLike & { items: Record<string, unknown> } = {
    items,
    get: vi.fn(async (key: string | null) =>
      key === null ? { ...items } : key in items ? { [key]: items[key] } : {},
    ),
    set: vi.fn(async (next: Record<string, unknown>) => {
      Object.assign(items, next);
    }),
    remove: vi.fn(async (key: string) => {
      delete items[key];
    }),
  };
  return storage;
}

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "HS256" })}.${encode(claims)}.signature`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const signal = () => new AbortController().signal;
const NOW = 1_800_000_000_000;

describe("Kimi token expiry", () => {
  test("reads the exp claim in milliseconds", () => {
    expect(kimiTokenExpiresAt(jwt({ exp: 1_800_000_900 }))).toBe(
      1_800_000_900_000,
    );
  });

  test.each(["opaque", "a.b.c", jwt({ exp: "soon" }), jwt({})])(
    "ignores a token without a readable expiry: %s",
    (token) => {
      expect(kimiTokenExpiresAt(token)).toBeUndefined();
    },
  );
});

describe("Kimi stored session", () => {
  test("caches the access token only when its expiry is readable", async () => {
    const storage = memoryStorage();
    await saveKimiStoredSession(storage, {
      refreshToken: "refresh",
      accessToken: "opaque-access",
    });
    expect(storage.items[KIMI_REFRESH_SESSION_KEY]).toEqual({
      refreshToken: "refresh",
    });

    const access = jwt({ exp: NOW / 1_000 + 900 });
    await saveKimiStoredSession(storage, {
      refreshToken: "refresh",
      accessToken: access,
    });
    expect(storage.items[KIMI_REFRESH_SESSION_KEY]).toEqual({
      refreshToken: "refresh",
      accessToken: access,
      accessExpiresAt: NOW + 900_000,
    });
  });

  test("ignores malformed stored values", async () => {
    await expect(
      readKimiStoredSession(
        memoryStorage({ [KIMI_REFRESH_SESSION_KEY]: { refreshToken: "" } }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readKimiStoredSession(memoryStorage({ [KIMI_REFRESH_SESSION_KEY]: "x" })),
    ).resolves.toBeUndefined();
  });
});

describe("Kimi refresh exchange", () => {
  test("posts the refresh token in the body without cookies", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { accessToken: "a2", refreshToken: "r2" }),
    );

    await expect(
      exchangeKimiRefreshToken({ fetch, refreshToken: "r1", signal: signal() }),
    ).resolves.toEqual({
      kind: "refreshed",
      accessToken: "a2",
      refreshToken: "r2",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(KIMI_REFRESH_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: "r1" });
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  test.each([401, 403])("reports %i as a rejected token", async (status) => {
    await expect(
      exchangeKimiRefreshToken({
        fetch: vi.fn(async () => jsonResponse(status, { code: "unauthenticated" })),
        refreshToken: "r1",
        signal: signal(),
      }),
    ).resolves.toEqual({ kind: "rejected" });
  });

  test.each([
    ["a server error", async () => jsonResponse(500, {})],
    ["a changed body", async () => jsonResponse(200, { token: "a2" })],
    ["a network failure", async () => Promise.reject(new TypeError("offline"))],
  ])("treats %s as unavailable", async (_label, respond) => {
    await expect(
      exchangeKimiRefreshToken({
        fetch: vi.fn(respond),
        refreshToken: "r1",
        signal: signal(),
      }),
    ).resolves.toEqual({ kind: "unavailable" });
  });
});

describe("Kimi stored-session token source", () => {
  test("returns nothing and makes no request without a held session", async () => {
    const fetch = vi.fn();
    const source = createKimiSessionHolder({
      storage: memoryStorage(),
      fetch,
      now: () => NOW,
    }).tokenFor;

    await expect(source(undefined, signal())).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("reuses a cached access token until shortly before it expires", async () => {
    const fetch = vi.fn();
    let now = NOW;
    const storage = memoryStorage({
      [KIMI_REFRESH_SESSION_KEY]: {
        refreshToken: "r1",
        accessToken: "a1",
        accessExpiresAt: NOW + 10 * 60_000,
      },
    });
    const source = createKimiSessionHolder({
      storage,
      fetch,
      now: () => now,
    }).tokenFor;

    await expect(source(undefined, signal())).resolves.toBe("a1");
    expect(fetch).not.toHaveBeenCalled();

    now = NOW + 10 * 60_000 - KIMI_ACCESS_EXPIRY_MARGIN_MS;
    fetch.mockResolvedValue(
      jsonResponse(200, { accessToken: "a2", refreshToken: "r2" }),
    );
    await expect(source(undefined, signal())).resolves.toBe("a2");
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("renews and stores the rotated pair when the cached token was rejected", async () => {
    const access = jwt({ exp: NOW / 1_000 + 900 });
    const storage = memoryStorage({
      [KIMI_REFRESH_SESSION_KEY]: {
        refreshToken: "r1",
        accessToken: "a1",
        accessExpiresAt: NOW + 10 * 60_000,
      },
    });
    const fetch = vi.fn(async () =>
      jsonResponse(200, { accessToken: access, refreshToken: "r2" }),
    );
    const source = createKimiSessionHolder({
      storage,
      fetch,
      now: () => NOW,
    }).tokenFor;

    await expect(source("a1", signal())).resolves.toBe(access);
    expect(storage.items[KIMI_REFRESH_SESSION_KEY]).toEqual({
      refreshToken: "r2",
      accessToken: access,
      accessExpiresAt: NOW + 900_000,
    });
  });

  test("forgets a refresh token that Kimi rejects", async () => {
    const storage = memoryStorage({
      [KIMI_REFRESH_SESSION_KEY]: { refreshToken: "r1" },
    });
    const source = createKimiSessionHolder({
      storage,
      fetch: vi.fn(async () => jsonResponse(401, {})),
      now: () => NOW,
    }).tokenFor;

    await expect(source(undefined, signal())).resolves.toBeUndefined();
    expect(storage.items).not.toHaveProperty(KIMI_REFRESH_SESSION_KEY);
  });

  test("keeps a newer page token stored while a rejected renewal was in flight", async () => {
    const storage = memoryStorage({
      [KIMI_REFRESH_SESSION_KEY]: { refreshToken: "r1" },
    });
    const source = createKimiSessionHolder({
      storage,
      fetch: vi.fn(async () => {
        storage.items[KIMI_REFRESH_SESSION_KEY] = { refreshToken: "page-r" };
        return jsonResponse(401, {});
      }),
      now: () => NOW,
    }).tokenFor;

    await expect(source(undefined, signal())).resolves.toBeUndefined();
    expect(storage.items[KIMI_REFRESH_SESSION_KEY]).toEqual({
      refreshToken: "page-r",
    });
  });

  test("keeps the held session when Kimi is temporarily unavailable", async () => {
    const storage = memoryStorage({
      [KIMI_REFRESH_SESSION_KEY]: { refreshToken: "r1" },
    });
    const source = createKimiSessionHolder({
      storage,
      fetch: vi.fn(async () => jsonResponse(503, {})),
      now: () => NOW,
    }).tokenFor;

    await expect(source(undefined, signal())).resolves.toBeUndefined();
    expect(storage.items[KIMI_REFRESH_SESSION_KEY]).toEqual({
      refreshToken: "r1",
    });
  });

  test("shares one renewal between concurrent callers", async () => {
    let resolve: (response: Response) => void = () => undefined;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const source = createKimiSessionHolder({
      storage: memoryStorage({
        [KIMI_REFRESH_SESSION_KEY]: { refreshToken: "r1" },
      }),
      fetch,
      now: () => NOW,
    }).tokenFor;

    const first = source(undefined, signal());
    const second = source(undefined, signal());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    resolve(jsonResponse(200, { accessToken: "a2", refreshToken: "r2" }));
    await expect(Promise.all([first, second])).resolves.toEqual(["a2", "a2"]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("does nothing once the collection is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn();
    const source = createKimiSessionHolder({
      storage: memoryStorage({
        [KIMI_REFRESH_SESSION_KEY]: { refreshToken: "r1" },
      }),
      fetch,
      now: () => NOW,
    }).tokenFor;

    await expect(source(undefined, controller.signal)).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Kimi session holder lifecycle", () => {
  test("keeps a rotated pair even when the caller aborted meanwhile", async () => {
    const controller = new AbortController();
    const storage = memoryStorage({
      [KIMI_REFRESH_SESSION_KEY]: { refreshToken: "r1", pageRefreshToken: "r1" },
    });
    const holder = createKimiSessionHolder({
      storage,
      fetch: vi.fn(async () => {
        controller.abort();
        return jsonResponse(200, { accessToken: "a2", refreshToken: "r2" });
      }),
      now: () => NOW,
    });

    await expect(
      holder.tokenFor(undefined, controller.signal),
    ).resolves.toBeUndefined();
    expect(storage.items[KIMI_REFRESH_SESSION_KEY]).toEqual({
      refreshToken: "r2",
      pageRefreshToken: "r1",
    });
  });

  test("discards a renewal that finishes after forget", async () => {
    const storage = memoryStorage({
      [KIMI_REFRESH_SESSION_KEY]: { refreshToken: "r1" },
    });
    let holder: ReturnType<typeof createKimiSessionHolder> | undefined;
    holder = createKimiSessionHolder({
      storage,
      fetch: vi.fn(async () => {
        await holder?.forget();
        return jsonResponse(200, { accessToken: "a2", refreshToken: "r2" });
      }),
      now: () => NOW,
    });

    await expect(holder.tokenFor(undefined, signal())).resolves.toBeUndefined();
    expect(storage.items).not.toHaveProperty(KIMI_REFRESH_SESSION_KEY);
  });

  test("discards a page save that finishes after forget", async () => {
    const storage = memoryStorage();
    const holder = createKimiSessionHolder({
      storage,
      fetch: vi.fn(),
      now: () => NOW,
    });
    const originalGet = storage.get;
    storage.get = vi.fn(async (key: string | null) => {
      await holder.forget();
      return originalGet(key);
    });

    await holder.rememberPageSession({ refreshToken: "page-r" });
    expect(storage.items).not.toHaveProperty(KIMI_REFRESH_SESSION_KEY);
  });

  test("does not overwrite a newer held chain with the page token it came from", async () => {
    const storage = memoryStorage({
      [KIMI_REFRESH_SESSION_KEY]: { refreshToken: "r2", pageRefreshToken: "r1" },
    });
    const holder = createKimiSessionHolder({
      storage,
      fetch: vi.fn(),
      now: () => NOW,
    });

    await holder.rememberPageSession({ accessToken: "a1", refreshToken: "r1" });
    expect(storage.items[KIMI_REFRESH_SESSION_KEY]).toEqual({
      refreshToken: "r2",
      pageRefreshToken: "r1",
    });

    await holder.rememberPageSession({ refreshToken: "page-r3" });
    expect(storage.items[KIMI_REFRESH_SESSION_KEY]).toEqual({
      refreshToken: "page-r3",
      pageRefreshToken: "page-r3",
    });
  });

  test("ignores a page without a refresh token", async () => {
    const storage = memoryStorage();
    const holder = createKimiSessionHolder({
      storage,
      fetch: vi.fn(),
      now: () => NOW,
    });

    await holder.rememberPageSession({ accessToken: "a1" });
    expect(storage.set).not.toHaveBeenCalled();
  });
});

describe("Kimi refresh rejection codes", () => {
  test("treats a Connect unauthenticated code as a rejected token", async () => {
    await expect(
      exchangeKimiRefreshToken({
        fetch: vi.fn(async () =>
          jsonResponse(400, { code: "unauthenticated" }),
        ),
        refreshToken: "r1",
        signal: signal(),
      }),
    ).resolves.toEqual({ kind: "rejected" });
  });
});
