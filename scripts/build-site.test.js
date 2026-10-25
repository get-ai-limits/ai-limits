// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  DOCUMENTS,
  REDIRECTS,
  REPOSITORY_URL,
  STORE_URL,
  buildSite,
  readProviders,
  redirectPage,
  rewriteHref,
  slugify,
} from "./build-site.mjs";
import { providerNames } from "../domain/provider-presentation";

let out;
beforeAll(async () => {
  out = await buildSite();
});

const page = (path) =>
  readFile(join(out, path.endsWith("/") ? `${path}index.html` : path), "utf8");

describe("site build", () => {
  it("lists every catalog provider on the landing page", async () => {
    const readme = await readFile("README.md", "utf8");
    const listed = readProviders(readme);
    expect(new Set(listed)).toEqual(new Set(Object.values(providerNames)));
    const home = await page("/");
    for (const name of listed) expect(home).toContain(`<li>${name}</li>`);
  });

  it("renders each document page from its repository source", async () => {
    for (const [file, { path }] of Object.entries(DOCUMENTS)) {
      const source = await readFile(file, "utf8");
      const title = source.match(/^# (.+)$/m)[1];
      expect(await page(path), file).toContain(`>${title}</h1>`);
    }
  });

  it("points the store button and short links at their destinations", async () => {
    expect(await page("/")).toContain(`href="${STORE_URL}"`);
    for (const [path, target] of Object.entries(REDIRECTS)) {
      expect(await page(path)).toContain(`url=${target}"`);
    }
    expect(REDIRECTS["/issues/"]).toBe(`${REPOSITORY_URL}/issues`);
  });

  it("writes the custom domain", async () => {
    expect(await page("/CNAME")).toBe("get-ai-limits.com\n");
  });
});

describe("rewriteHref", () => {
  it("maps rendered documents to site pages and keeps anchors", () => {
    expect(rewriteHref("PRIVACY.md")).toBe("/privacy/");
    expect(rewriteHref("FAQ.zh-CN.md#x")).toBe("/zh-CN/faq/#x");
    expect(rewriteHref("README.md")).toBe("/");
  });

  it("sends other repository files to GitHub and leaves absolute links alone", () => {
    expect(rewriteHref("LICENSE")).toBe(`${REPOSITORY_URL}/blob/main/LICENSE`);
    expect(rewriteHref("https://example.com/a.md")).toBe("https://example.com/a.md");
    expect(rewriteHref("mailto:a@example.com")).toBe("mailto:a@example.com");
    expect(rewriteHref("#top")).toBe("#top");
  });
});

describe("helpers", () => {
  it("slugifies headings like GitHub", () => {
    expect(slugify("Does History update after manual refresh?")).toBe(
      "does-history-update-after-manual-refresh",
    );
  });

  it("escapes redirect targets", () => {
    expect(redirectPage("/x/", 'https://a.test/"<b>')).not.toContain('"<b>');
  });
});
