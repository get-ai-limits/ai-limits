import { describe, expect, it } from "vitest";

import {
  fetchGumloopRepliesInPage,
  parseGumloopPageReplies,
  parseGumloopPageSession,
  readGumloopPageSessionAtExpectedOrigin,
} from "./page-session";

describe("gumloop page session", () => {
  it("validates the injected session read", () => {
    expect(
      parseGumloopPageSession({
        accessToken: " id ",
        accessExpiresAt: 123,
        refreshToken: "refresh",
        apiKey: "key",
        userId: "user-1",
        extra: "ignored",
      }),
    ).toEqual({
      accessToken: "id",
      accessExpiresAt: 123,
      refreshToken: "refresh",
      apiKey: "key",
      userId: "user-1",
    });
    expect(parseGumloopPageSession({ signedOut: true, accessToken: "x" })).toEqual({
      signedOut: true,
    });
    // A user id alone, or tokens without a user id, cannot be used.
    expect(parseGumloopPageSession({ userId: "user-1" })).toBeUndefined();
    expect(parseGumloopPageSession({ accessToken: "id" })).toBeUndefined();
    expect(
      parseGumloopPageSession({
        accessToken: "id",
        userId: "user-1",
        accessExpiresAt: "soon",
      }),
    ).toEqual({ accessToken: "id", userId: "user-1" });
    expect(parseGumloopPageSession("token")).toBeUndefined();
    expect(parseGumloopPageSession(null)).toBeUndefined();
  });

  it("validates the injected usage replies", () => {
    expect(
      parseGumloopPageReplies({
        project: { status: 200, body: [] },
        remaining: { status: 200, body: { remaining: 1 }, retryAfter: 5 },
        subscription: { status: "200" },
      }),
    ).toEqual({
      project: { status: 200, body: [] },
      remaining: { status: 200, body: { remaining: 1 } },
    });
    expect(parseGumloopPageReplies({ project: { status: 1.5 } })).toBeUndefined();
    expect(parseGumloopPageReplies(undefined)).toBeUndefined();
  });

  it("does nothing outside the expected origin", async () => {
    await expect(
      readGumloopPageSessionAtExpectedOrigin("https://www.gumloop.com"),
    ).resolves.toBeUndefined();
    await expect(
      fetchGumloopRepliesInPage(
        "https://www.gumloop.com",
        "https://api.gumloop.com",
        "id",
        "user-1",
        1_000,
      ),
    ).resolves.toBeUndefined();
  });
});
