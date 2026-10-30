// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  DOCUMENTS,
  PROVIDER_GROUPS,
  REDIRECTS,
  REPOSITORY_URL,
  STORE_URL,
  buildSite,
  readProviders,
  redirectPage,
  rewriteHref,
  sitemapPaths,
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

  it("lists every catalog provider once on the providers pages", async () => {
    const grouped = PROVIDER_GROUPS.flatMap(({ providers }) => providers.map(([name]) => name));
    expect(grouped).toHaveLength(new Set(grouped).size);
    expect(new Set(grouped)).toEqual(new Set(Object.values(providerNames)));
    for (const path of ["/providers/", "/zh-CN/providers/"]) {
      const html = await page(path);
      for (const name of grouped) expect(html).toContain(`<strong>${name}</strong>`);
    }
  });

  it("states the catalog's provider count in the marketing copy", async () => {
    const count = Object.keys(providerNames).length;
    expect(await page("/")).toContain(`Works with ${count} AI services`);
    expect(await page("/")).toContain(`and ${count - 3} more services`);
    expect(await page("/zh-CN/")).toContain(`支持 ${count} 个 AI 服务`);
  });

  it("references only assets that the build emits", async () => {
    for (const path of sitemapPaths()) {
      const html = await page(path);
      for (const [, ref] of html.matchAll(/(?:src|href|content)="(?:https:\/\/get-ai-limits\.com)?(\/assets\/[^"]+)"/g)) {
        await expect(page(ref), `${path} -> ${ref}`).resolves.toBeTruthy();
      }
    }
  });

  it("keeps internal schema-evidence wording off the public site", async () => {
    for (const path of sitemapPaths()) {
      const html = await page(path);
      expect(html, path).not.toMatch(/provenance|OBSERVED|INFERRED|来源等级/);
    }
  });

  it("gives every indexable page SEO metadata and lists it in the sitemap", async () => {
    const sitemap = await page("/sitemap.xml");
    for (const path of sitemapPaths()) {
      const html = await page(path);
      expect(html, path).toContain(`<link rel="canonical" href="https://get-ai-limits.com${path}">`);
      expect(html, path).toMatch(/<meta name="description" content="[^"]{40,}">/);
      expect(sitemap).toContain(`<loc>https://get-ai-limits.com${path}</loc>`);
    }
    expect(await page("/robots.txt")).toContain("Sitemap: https://get-ai-limits.com/sitemap.xml");
    expect(await page("/")).toContain('hreflang="zh-CN" href="https://get-ai-limits.com/zh-CN/"');
  });

  it("embeds valid structured data on the landing pages", async () => {
    for (const path of ["/", "/zh-CN/"]) {
      const blocks = [...(await page(path)).matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)]
        .map((match) => JSON.parse(match[1]));
      expect(blocks.map((block) => block["@type"])).toEqual(["SoftwareApplication", "FAQPage"]);
      expect(blocks[1].mainEntity.length).toBeGreaterThan(0);
    }
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

  it("shows the screenshots in a carousel with working assets", async () => {
    for (const path of ["/", "/zh-CN/"]) {
      const home = await page(path);
      expect(home.match(/<li><img /g)).toHaveLength(3);
      expect(home.match(/<div class="dots">(.*?)<\/div>/)[1].match(/<button /g)).toHaveLength(3);
      expect(home).toContain('<script src="/assets/carousel.js" defer></script>');
    }
    expect(await page("/assets/carousel.js")).toContain(".carousel");
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
    expect(rewriteHref("SUPPORTED_PROVIDERS.md#x")).toBe(`${REPOSITORY_URL}/blob/main/SUPPORTED_PROVIDERS.md#x`);
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
