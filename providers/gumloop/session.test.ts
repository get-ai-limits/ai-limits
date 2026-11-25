import { describe, expect, it, vi } from "vitest";

import type { StorageSessionLike } from "../tab-ensure";
import {
  createGumloopSessionHolder,
  exchangeGumloopRefreshToken,
  GUMLOOP_SESSION_KEY,
} from "./session";

const NOW = 1_800_000_000_000;

function memoryStorage(initial: Record<string, unknown> = {}) {
  const items: Record<string, unknown> = { ...initial };
  const storage: StorageSessionLike = {
    get: vi.fn(async (key: string | null) =>
      key === null ? { ...items } : key in items ? { [key]: items[key] } : {},
    ),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(items, values);
    }),
    remove: vi.fn(async (key: string) => {
      delete items[key];
    }),
  };
  return { storage, items };
}

const held = {
  refreshToken: "refresh-1",
  apiKey: "public-web-key",
  userId: "user-1",
};

function refreshed(body: Record<string, unknown> = {}) {
  return Response.json({
    id_token: "id-2",
    access_token: "id-2",
    refresh_token: "refresh-1",
    expires_in: "3600",
    user_id: "user-1",
    ...body,
  });
}

describe("exchangeGumloopRefreshToken", () => {
  it("posts only the refresh token to Firebase's token service, without cookies", async () => {
    const fetch = vi.fn(async () => refreshed());
    const signal = new AbortController().signal;
    await expect(
      exchangeGumloopRefreshToken({
        fetch,
        refreshToken: "refresh-1",
        apiKey: "public web/key",
        signal,
        now: NOW,
      }),
    ).resolves.toEqual({
      kind: "refreshed",
      accessToken: "id-2",
      refreshToken: "refresh-1",
      accessExpiresAt: NOW + 3_600_000,
      userId: "user-1",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://securetoken.googleapis.com/v1/token?key=public%20web%2Fkey",
      {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=refresh_token&refresh_token=refresh-1",
        signal,
      },
    );
  });

  it("separates a rejected refresh token from a temporary failure", async () => {
    const call = (response: Response | Error) =>
      exchangeGumloopRefreshToken({
        fetch: vi.fn(async () => {
          if (response instanceof Error) throw response;
          return response;
        }),
        refreshToken: "refresh-1",
        apiKey: "key",
        signal: new AbortController().signal,
        now: NOW,
      });
    await expect(
      call(
        Response.json(
          { error: { code: 400, message: "TOKEN_EXPIRED : expired" } },
          { status: 400 },
        ),
      ),
    ).resolves.toEqual({ kind: "rejected" });
    await expect(
      call(
        Response.json(
          { error: { code: 400, message: "INVALID_REFRESH_TOKEN" } },
          { status: 400 },
        ),
      ),
    ).resolves.toEqual({ kind: "rejected" });
    await expect(
      call(Response.json({ error: { message: "BACKEND" } }, { status: 503 })),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(call(new TypeError("offline"))).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(call(Response.json({ refresh_token: "r" }))).resolves.toEqual({
      kind: "unavailable",
    });
  });
});

describe("createGumloopSessionHolder", () => {
  const signal = () => new AbortController().signal;

  it("returns a still-fresh held ID token without calling the token service", async () => {
    const { storage } = memoryStorage({
      [GUMLOOP_SESSION_KEY]: {
        ...held,
        accessToken: "id-1",
        accessExpiresAt: NOW + 30 * 60_000,
      },
    });
    const fetch = vi.fn();
    const holder = createGumloopSessionHolder({ storage, fetch, now: () => NOW });
    await expect(holder.credentialsFor(undefined, signal())).resolves.toEqual({
      kind: "credentials",
      credentials: { accessToken: "id-1", userId: "user-1" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renews an expiring or rejected ID token and keeps the new one", async () => {
    const { storage, items } = memoryStorage({
      [GUMLOOP_SESSION_KEY]: {
        ...held,
        accessToken: "id-1",
        accessExpiresAt: NOW + 30_000,
      },
    });
    const fetch = vi.fn(async () => refreshed());
    const holder = createGumloopSessionHolder({ storage, fetch, now: () => NOW });
    await expect(holder.credentialsFor(undefined, signal())).resolves.toEqual({
      kind: "credentials",
      credentials: { accessToken: "id-2", userId: "user-1" },
    });
    expect(items[GUMLOOP_SESSION_KEY]).toEqual({
      ...held,
      accessToken: "id-2",
      accessExpiresAt: NOW + 3_600_000,
    });
    // The fresh token was the one rejected, so the next call renews again.
    fetch.mockResolvedValueOnce(refreshed({ id_token: "id-3" }));
    await expect(holder.credentialsFor("id-2", signal())).resolves.toEqual({
      kind: "credentials",
      credentials: { accessToken: "id-3", userId: "user-1" },
    });
  });

  it("drops the held session when the refresh token is rejected", async () => {
    const { storage, items } = memoryStorage({ [GUMLOOP_SESSION_KEY]: held });
    const fetch = vi.fn(async () =>
      Response.json(
        { error: { message: "INVALID_REFRESH_TOKEN" } },
        { status: 400 },
      ),
    );
    const holder = createGumloopSessionHolder({ storage, fetch, now: () => NOW });
    await expect(holder.credentialsFor(undefined, signal())).resolves.toEqual({
      kind: "rejected",
    });
    expect(items[GUMLOOP_SESSION_KEY]).toBeUndefined();
  });

  it("refuses a renewal for a different user", async () => {
    const { storage } = memoryStorage({ [GUMLOOP_SESSION_KEY]: held });
    const fetch = vi.fn(async () => refreshed({ user_id: "someone-else" }));
    const holder = createGumloopSessionHolder({ storage, fetch, now: () => NOW });
    await expect(holder.credentialsFor(undefined, signal())).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("holds a page session and drops it when the page is signed out", async () => {
    const { storage, items } = memoryStorage();
    const holder = createGumloopSessionHolder({
      storage,
      fetch: vi.fn(),
      now: () => NOW,
    });
    await holder.rememberPageSession(
      {
        ...held,
        accessToken: "id-page",
        accessExpiresAt: NOW + 3_000_000,
      },
      holder.beginPageRead(),
    );
    expect(items[GUMLOOP_SESSION_KEY]).toEqual({
      ...held,
      accessToken: "id-page",
      accessExpiresAt: NOW + 3_000_000,
    });
    await holder.rememberPageSession({ signedOut: true }, holder.beginPageRead());
    expect(items[GUMLOOP_SESSION_KEY]).toBeUndefined();
  });

  it("keeps a newer renewed token over an older page token for the same user", async () => {
    const { storage, items } = memoryStorage({
      [GUMLOOP_SESSION_KEY]: {
        ...held,
        accessToken: "id-renewed",
        accessExpiresAt: NOW + 3_500_000,
      },
    });
    const holder = createGumloopSessionHolder({
      storage,
      fetch: vi.fn(),
      now: () => NOW,
    });
    await holder.rememberPageSession(
      { ...held, accessToken: "id-old", accessExpiresAt: NOW + 100_000 },
      holder.beginPageRead(),
    );
    expect(items[GUMLOOP_SESSION_KEY]).toMatchObject({
      accessToken: "id-renewed",
    });
  });

  it("does not let a page read that began before forget bring the session back", async () => {
    const { storage, items } = memoryStorage();
    const holder = createGumloopSessionHolder({
      storage,
      fetch: vi.fn(),
      now: () => NOW,
    });
    const startedIn = holder.beginPageRead();
    await holder.forget();
    await holder.rememberPageSession(held, startedIn);
    expect(items[GUMLOOP_SESSION_KEY]).toBeUndefined();
  });

  it("does not let a write cancelled by forget delete a newer session", async () => {
    const { storage, items } = memoryStorage();
    const holder = createGumloopSessionHolder({
      storage,
      fetch: vi.fn(),
      now: () => NOW,
    });
    const stale = holder.beginPageRead();
    const newer = { ...held, refreshToken: "refresh-new" };
    // forget() and a newer page read land while the stale write is in flight.
    vi.mocked(storage.set).mockImplementationOnce(async (values) => {
      Object.assign(items, values);
      await holder.forget();
      await holder.rememberPageSession(newer, holder.beginPageRead());
    });
    await holder.rememberPageSession(held, stale);
    expect(items[GUMLOOP_SESSION_KEY]).toEqual(newer);
  });

  it("ignores a page session without the parts needed to renew", async () => {
    const { storage, items } = memoryStorage();
    const holder = createGumloopSessionHolder({
      storage,
      fetch: vi.fn(),
      now: () => NOW,
    });
    await holder.rememberPageSession(
      { userId: "user-1", accessToken: "id", accessExpiresAt: NOW + 1 },
      holder.beginPageRead(),
    );
    expect(items[GUMLOOP_SESSION_KEY]).toBeUndefined();
  });
});
