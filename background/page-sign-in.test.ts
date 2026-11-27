import { afterEach, describe, expect, test, vi } from "vitest";

import { cursorSavedSession, chatGptSavedSession } from "../providers/saved-session-specs";
import { siteTabStillSignedIn } from "./page-sign-in";

afterEach(() => {
  vi.restoreAllMocks();
});

function tabs(...ids: number[]) {
  return ids.map((id) => ({ id, discarded: false })) as Browser.tabs.Tab[];
}

describe("siteTabStillSignedIn", () => {
  test("asks open tabs of the site whether they are still signed in", async () => {
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
    const query = vi.spyOn(browser.tabs, "query").mockResolvedValue(tabs(1, 2) as never);
    const execute = vi
      .spyOn(browser.scripting, "executeScript")
      .mockRejectedValueOnce(new Error("Frame is loading"))
      .mockResolvedValueOnce([{ result: true }] as never);

    await expect(siteTabStillSignedIn(cursorSavedSession)).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith({ url: "https://cursor.com/*" });
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: { tabId: 2 },
        args: ["https://cursor.com/api/auth/me"],
      }),
    );
  });

  test("is false when no tab is signed in, without scripting, or without a check", async () => {
    const contains = vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
    vi.spyOn(browser.tabs, "query").mockResolvedValue(tabs(1) as never);
    vi.spyOn(browser.scripting, "executeScript").mockResolvedValue([
      { result: false },
    ] as never);
    await expect(siteTabStillSignedIn(cursorSavedSession)).resolves.toBe(false);

    contains.mockResolvedValue(false as never);
    await expect(siteTabStillSignedIn(cursorSavedSession)).resolves.toBe(false);

    contains.mockResolvedValue(true as never);
    await expect(siteTabStillSignedIn(chatGptSavedSession)).resolves.toBe(false);
  });

  test("counts a tab as signed in only when the identity names an account", async () => {
    vi.spyOn(browser.permissions, "contains").mockResolvedValue(true as never);
    vi.spyOn(browser.tabs, "query").mockResolvedValue(tabs(1) as never);
    const responses = [
      new Response(JSON.stringify({ sub: "user_1" })),
      new Response("{}"),
      new Response("<html>Sign in</html>"),
      new Response(null, { status: 401 }),
    ];
    const pageFetch = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", pageFetch);
    vi.spyOn(browser.scripting, "executeScript").mockImplementation((async (
      injection: { func: (url: string) => Promise<boolean>; args: [string] },
    ) => [{ result: await injection.func(...injection.args) }]) as never);
    try {
      const results = [];
      for (let i = 0; i < 4; i += 1) {
        results.push(await siteTabStillSignedIn(cursorSavedSession));
      }
      expect(results).toEqual([true, false, false, false]);
      expect(pageFetch).toHaveBeenCalledWith(
        "https://cursor.com/api/auth/me",
        expect.objectContaining({ redirect: "manual", credentials: "include" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
