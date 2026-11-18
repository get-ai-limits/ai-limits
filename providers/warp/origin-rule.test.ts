import { describe, expect, test, vi } from "vitest";
import {
  extensionOriginHost,
  installWarpOriginRule,
  WARP_ORIGIN_RULE_ID,
  WARP_USAGE_URL,
} from "./origin-rule";

describe("Warp origin rule", () => {
  test("replaces one session rule that strips Origin from the usage request only", async () => {
    const updateSessionRules = vi.fn(async () => {});

    await installWarpOriginRule({ updateSessionRules }, "extension-id");

    expect(updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [WARP_ORIGIN_RULE_ID],
      addRules: [
        {
          id: WARP_ORIGIN_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "origin", operation: "remove" }],
          },
          condition: {
            urlFilter:
              "|https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo|",
            requestMethods: ["post"],
            resourceTypes: ["xmlhttprequest"],
            initiatorDomains: ["extension-id"],
            tabIds: [-1],
          },
        },
      ],
    });
    expect(WARP_USAGE_URL).toBe(
      "https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo",
    );
  });

  test("matches the initiator by the extension origin host on every browser", () => {
    expect(
      extensionOriginHost(() => "chrome-extension://abcdefghijklmnop/"),
    ).toBe("abcdefghijklmnop");
    expect(
      extensionOriginHost(
        () => "moz-extension://0d5c7a61-3b2e-4f7a-9c1e-2b8f6d4e9a10/",
      ),
    ).toBe("0d5c7a61-3b2e-4f7a-9c1e-2b8f6d4e9a10");
  });
});
