import { describe, expect, test, vi } from "vitest";

import {
  parseKimiPageSession,
  readKimiPageSessionAtExpectedOrigin,
} from "./page-session";

function storageWith(values: Record<string, string>) {
  return { getItem: vi.fn((key: string) => values[key] ?? null) };
}

describe("Kimi page credential isolation", () => {
  test("reads only the exact token keys when the executing page is still on Kimi", () => {
    const storage = storageWith({
      access_token: "kimi-access",
      refresh_token: "kimi-refresh",
      other: "unrelated",
    });

    expect(
      readKimiPageSessionAtExpectedOrigin(
        "https://www.kimi.com",
        storage,
        "https://www.kimi.com",
        true,
      ),
    ).toEqual({ accessToken: "kimi-access", refreshToken: "kimi-refresh" });
    expect(storage.getItem.mock.calls.map(([key]) => key).sort()).toEqual([
      "access_token",
      "refresh_token",
    ]);
  });

  test("reports missing keys as undefined", () => {
    expect(
      readKimiPageSessionAtExpectedOrigin(
        "https://www.kimi.com",
        storageWith({}),
        "https://www.kimi.com",
        true,
      ),
    ).toEqual({ accessToken: undefined, refreshToken: undefined });
  });

  test("does not read storage until Kimi's client app has mounted", () => {
    const storage = storageWith({ access_token: "stale-token" });

    expect(
      readKimiPageSessionAtExpectedOrigin(
        "https://www.kimi.com",
        storage,
        "https://www.kimi.com",
        false,
      ),
    ).toBeUndefined();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  test("uses the page mount flag when the caller does not pass one", () => {
    const storage = storageWith({ access_token: "kimi-token" });
    const host = globalThis as { __kimiAppMounted?: unknown };
    const previous = host.__kimiAppMounted;
    host.__kimiAppMounted = true;

    try {
      expect(
        readKimiPageSessionAtExpectedOrigin(
          "https://www.kimi.com",
          storage,
          "https://www.kimi.com",
        )?.accessToken,
      ).toBe("kimi-token");
    } finally {
      if (previous === undefined) delete host.__kimiAppMounted;
      else host.__kimiAppMounted = previous;
    }
  });

  test("does not touch storage after a selected tab navigates to another origin", () => {
    const storage = storageWith({ access_token: "other-provider-token" });

    expect(
      readKimiPageSessionAtExpectedOrigin(
        "https://www.kimi.com",
        storage,
        "https://chatgpt.com",
        true,
      ),
    ).toBeUndefined();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  test("keeps only non-empty string tokens from the injected result", () => {
    expect(parseKimiPageSession(undefined)).toEqual({});
    expect(parseKimiPageSession("token")).toEqual({});
    expect(
      parseKimiPageSession({ accessToken: " a ", refreshToken: 42 }),
    ).toEqual({ accessToken: "a" });
    expect(
      parseKimiPageSession({ accessToken: "", refreshToken: "r" }),
    ).toEqual({ refreshToken: "r" });
  });
});
