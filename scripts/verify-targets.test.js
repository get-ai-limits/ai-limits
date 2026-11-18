import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import {
  EXPECTED_OPTIONAL_ORIGINS,
  FIREFOX_ADDON_ID,
  FIREFOX_MIN_VERSION,
  validateFirefoxManifest,
} from "./artifact-contract.mjs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

function firefoxManifest() {
  return {
    manifest_version: 3,
    name: "__MSG_manifest_name__",
    description: "__MSG_manifest_descriptionFirefox__",
    version,
    default_locale: "en",
    icons: {
      16: "icons/16.png",
      32: "icons/32.png",
      48: "icons/48.png",
      128: "icons/128.png",
    },
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_ADDON_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        data_collection_permissions: { required: ["none"] },
      },
    },
    permissions: ["storage", "alarms", "declarativeNetRequestWithHostAccess"],
    optional_host_permissions: [...EXPECTED_OPTIONAL_ORIGINS],
    optional_permissions: ["cookies", "scripting"],
    action: { default_title: "__MSG_manifest_actionTitle__" },
    background: { scripts: ["background.js"] },
    sidebar_action: { default_panel: "sidepanel.html" },
  };
}

describe("Firefox manifest contract", () => {
  test("accepts the expected Firefox manifest and rejects drift", () => {
    expect(validateFirefoxManifest(firefoxManifest(), version)).toEqual([]);

    const withSidePanel = firefoxManifest();
    withSidePanel.permissions.push("sidePanel");
    expect(validateFirefoxManifest(withSidePanel, version)).toContain(
      "Expected no sidePanel permission in the Firefox manifest.",
    );

    const collecting = firefoxManifest();
    collecting.browser_specific_settings.gecko.data_collection_permissions = {
      required: ["browsingActivity"],
    };
    expect(validateFirefoxManifest(collecting, version)).toContain(
      'Expected Firefox data_collection_permissions to declare required ["none"].',
    );

    const renamed = firefoxManifest();
    renamed.browser_specific_settings.gecko.id = "other@example.com";
    expect(validateFirefoxManifest(renamed, version).length).toBeGreaterThan(0);
  });
});
