import { beforeEach, describe, expect, test } from "vitest";
import {
  SAVED_SESSION_STORAGE_KEY,
  deleteAllSavedSessions,
  deleteSavedSession,
  hasSavedSessions,
  normalizeSavedSession,
  readSavedSession,
  saveSession,
} from "./saved-sessions";

const A = "cursor:00000000-0000-4000-8000-00000000000a" as const;
const B = "cursor:00000000-0000-4000-8000-00000000000b" as const;
const C = "chatgpt:00000000-0000-4000-8000-00000000000c" as const;

beforeEach(async () => {
  await browser.storage.local.clear();
});

describe("saved sign-ins", () => {
  test("saves, reads and deletes one connection's sign-in", async () => {
    await saveSession(A, [{ name: "Token", value: "synthetic-a" }], 10);

    await expect(readSavedSession(A)).resolves.toEqual({
      cookies: [{ name: "Token", value: "synthetic-a" }],
      savedAt: 10,
    });
    await expect(readSavedSession(B)).resolves.toBeUndefined();
    await expect(hasSavedSessions()).resolves.toBe(true);

    await deleteSavedSession(A);
    await expect(readSavedSession(A)).resolves.toBeUndefined();
    await expect(hasSavedSessions()).resolves.toBe(false);
  });

  test("does not rewrite storage when the same cookies are saved again", async () => {
    await saveSession(A, [{ name: "Token", value: "synthetic-a" }], 10);
    await saveSession(A, [{ name: "Token", value: "synthetic-a" }], 20);

    await expect(readSavedSession(A)).resolves.toMatchObject({ savedAt: 10 });

    await saveSession(A, [{ name: "Token", value: "synthetic-b" }], 30);
    await expect(readSavedSession(A)).resolves.toEqual({
      cookies: [{ name: "Token", value: "synthetic-b" }],
      savedAt: 30,
    });
  });

  test("treats a sign-in whose cookies all expired as gone", async () => {
    await saveSession(
      C,
      [{ name: "Token", value: "synthetic", expirationDate: 100 }],
      10,
    );

    await expect(readSavedSession(C, 99_000)).resolves.toBeDefined();
    await expect(readSavedSession(C, 100_000)).resolves.toBeUndefined();
    // And it is removed, not just hidden.
    await expect(hasSavedSessions()).resolves.toBe(false);
  });

  test("drops cookies that could break or inject into a Cookie header", () => {
    expect(
      normalizeSavedSession({
        savedAt: 1,
        cookies: [
          { name: "Good", value: "abc.def-_" },
          { name: "Bad", value: "a; Other=b" },
          { name: "Bad Name", value: "x" },
          { name: "Empty", value: "" },
          { name: "Crlf", value: "a\r\nX: y" },
        ],
      }),
    ).toEqual({ savedAt: 1, cookies: [{ name: "Good", value: "abc.def-_" }] });
    expect(
      normalizeSavedSession({ savedAt: 1, cookies: [{ name: "Bad", value: "a;b" }] }),
    ).toBeUndefined();
  });

  test("ignores malformed storage and unknown connection ids", async () => {
    await browser.storage.local.set({
      [SAVED_SESSION_STORAGE_KEY]: {
        version: 1,
        sessions: {
          "not an id": { savedAt: 1, cookies: [{ name: "A", value: "b" }] },
          [A]: { savedAt: "x", cookies: [] },
        },
      },
    });

    await expect(hasSavedSessions()).resolves.toBe(false);
  });

  test("deleting everything removes the storage key", async () => {
    await saveSession(A, [{ name: "Token", value: "synthetic" }], 1);
    await deleteAllSavedSessions();

    await expect(
      browser.storage.local.get(SAVED_SESSION_STORAGE_KEY),
    ).resolves.toEqual({});
  });
});
