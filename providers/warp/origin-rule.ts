// Warp's app server answers 403 to any request carrying an Origin header,
// and browsers stamp extension fetches with the extension origin
// (`chrome-extension://<id>` in Chromium, `moz-extension://<uuid>` in Firefox).
// This session rule removes that header from AI Limits' own usage request and
// nothing else: one exact URL, POST only, from this extension's service worker.
// It takes effect only while the optional app.warp.dev host access is granted.

export const WARP_ORIGIN_RULE_ID = 1;
export const WARP_USAGE_URL =
  "https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo";

type SessionRulesApi = Pick<
  typeof browser.declarativeNetRequest,
  "updateSessionRules"
>;

// The initiator is matched by the extension origin's host. In Chromium that
// host is the extension ID; in Firefox it is a per-install UUID that differs
// from the add-on ID, so it is read from the extension's own URL.
export function extensionOriginHost(
  getURL: (path: "/") => string = (path) => browser.runtime.getURL(path),
): string {
  return new URL(getURL("/")).hostname;
}

export function warpOriginRule(
  extensionHost: string,
): Browser.declarativeNetRequest.Rule {
  return {
    id: WARP_ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "origin", operation: "remove" }],
    },
    condition: {
      urlFilter: `|${WARP_USAGE_URL}|`,
      requestMethods: ["post"],
      resourceTypes: ["xmlhttprequest"],
      initiatorDomains: [extensionHost],
      // Service-worker requests have no tab.
      tabIds: [-1],
    },
  };
}

export async function installWarpOriginRule(
  api: SessionRulesApi = browser.declarativeNetRequest,
  extensionHost: string = extensionOriginHost(),
): Promise<void> {
  await api.updateSessionRules({
    removeRuleIds: [WARP_ORIGIN_RULE_ID],
    addRules: [warpOriginRule(extensionHost)],
  });
}
