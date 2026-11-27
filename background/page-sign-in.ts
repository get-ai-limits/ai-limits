import type { SavedSessionSpec } from "../providers/saved-session";

/** Runs in a page of the site: whether the page is signed in there. */
async function pageSignedInCheck(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

const MAX_TABS_CHECKED = 3;

/**
 * Whether an open tab of the site is still signed in, asked from the tab
 * itself. The extension's own requests can find the browser signed out while
 * a page of the site keeps its sign-in, so Add account checks here before it
 * says the browser is signed out. False without a check URL, an open tab, or
 * the scripting permission.
 */
export async function siteTabStillSignedIn(spec: SavedSessionSpec): Promise<boolean> {
  const url = spec.pageSignInCheckUrl;
  if (!url) return false;
  try {
    if (!(await browser.permissions.contains({ permissions: ["scripting"] }))) {
      return false;
    }
    const tabs = await browser.tabs.query({
      url: `${new URL(spec.siteUrl).origin}/*`,
    });
    for (const tab of tabs.slice(0, MAX_TABS_CHECKED)) {
      if (tab.id === undefined || tab.discarded) continue;
      try {
        const [result] = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: pageSignedInCheck,
          args: [url],
        });
        if (result?.result === true) return true;
      } catch {
        // A tab that is loading or shows an error page cannot be asked.
      }
    }
  } catch {
    // Without tabs to ask, the extension's own read stands.
  }
  return false;
}
