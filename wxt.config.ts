import { defineConfig } from "wxt";
import { providerDefinitions } from "./providers/definitions";

const providers = Object.values(providerDefinitions);

// Permanent Firefox add-on ID. AMO ties the listing and every future update
// to it, so it must never change once published.
const FIREFOX_ADDON_ID = "ai-limits@get-ai-limits.com";
// 140 is the first Firefox ESR with built-in data collection consent, and it
// covers every API the extension uses (MV3 DNR session rules, storage.session,
// optional_host_permissions).
const FIREFOX_MIN_VERSION = "140.0";

export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
  zip: {
    // The Firefox sources archive (AMO review) must hold only committed
    // files, so skip the gitignored output folders (dotfiles and tests are
    // already excluded by WXT). `pnpm verify:targets` enforces this.
    excludeSources: ["dist/**", "coverage/**", "artifacts/**"],
  },
  hooks: {
    "entrypoints:found": (_wxt, entrypoints) => {
      const productionEntrypoints = entrypoints.filter(
        ({ inputPath }) => !inputPath.includes(".test."),
      );
      entrypoints.splice(0, entrypoints.length, ...productionEntrypoints);
    },
  },
  manifest: ({ browser }) => ({
    name: "__MSG_manifest_name__",
    // The Chrome description names Chrome's side panel; the other stores get
    // their own browser's name so the listing summary is accurate.
    description:
      browser === "firefox"
        ? "__MSG_manifest_descriptionFirefox__"
        : browser === "edge"
          ? "__MSG_manifest_descriptionEdge__"
          : "__MSG_manifest_description__",
    default_locale: "en",
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: FIREFOX_ADDON_ID,
              strict_min_version: FIREFOX_MIN_VERSION,
              // AI Limits sends nothing to its developers; see PRIVACY.md.
              data_collection_permissions: { required: ["none"] },
            },
          },
        }
      : { minimum_chrome_version: "116" }),
    permissions: [
      "storage",
      "alarms",
      // Firefox has no sidePanel API; WXT emits sidebar_action instead.
      ...(browser === "firefox" ? [] : ["sidePanel"]),
      "declarativeNetRequestWithHostAccess",
    ],
    optional_host_permissions: [
      ...new Set(providers.flatMap(({ optionalOrigins }) => optionalOrigins)),
    ],
    optional_permissions: [
      ...new Set(
        providers.flatMap(({ optionalPermissions }) => optionalPermissions),
      ),
    ],
    icons: {
      16: "icons/16.png",
      32: "icons/32.png",
      48: "icons/48.png",
      128: "icons/128.png",
    },
    action: {
      default_title: "__MSG_manifest_actionTitle__",
      default_icon: {
        16: "icons/16.png",
        32: "icons/32.png",
        48: "icons/48.png",
        128: "icons/128.png",
      },
    },
  }),
});
