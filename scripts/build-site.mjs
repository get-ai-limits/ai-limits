// Builds the static get-ai-limits.com site into dist/site.
//
// The repository's Markdown documents stay the single source of truth: the
// privacy policy, supported providers, FAQ, and security pages are rendered
// from them at build time, and the short links (/issues, /source, ...) are
// redirect pages so the extension and store listing can point at URLs that
// survive a repository move.

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import MarkdownIt from "markdown-it";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "site");

export const SITE_ORIGIN = "https://get-ai-limits.com";
export const REPOSITORY_URL = "https://github.com/get-ai-limits/ai-limits";
export const STORE_URL =
  "https://chromewebstore.google.com/detail/ai-limits/hcfdchpajckemcdflcjhigngpipdkdeo";

/** Stable short links. Keys are site paths, values are their destinations. */
export const REDIRECTS = {
  "/issues/": `${REPOSITORY_URL}/issues`,
  "/support/": `${REPOSITORY_URL}/issues`,
  "/source/": REPOSITORY_URL,
  "/releases/": `${REPOSITORY_URL}/releases`,
  "/changelog/": `${REPOSITORY_URL}/releases`,
  "/install/": STORE_URL,
};

/** Rendered documents. Keys are repository files, values are site paths. */
export const DOCUMENTS = {
  "PRIVACY.md": { path: "/privacy/", lang: "en" },
  "SUPPORTED_PROVIDERS.md": { path: "/providers/", lang: "en" },
  "SUPPORTED_PROVIDERS.zh-CN.md": { path: "/zh-CN/providers/", lang: "zh-CN" },
  "FAQ.md": { path: "/faq/", lang: "en" },
  "FAQ.zh-CN.md": { path: "/zh-CN/faq/", lang: "zh-CN" },
  "SECURITY.md": { path: "/security/", lang: "en" },
};

const PAGE_LINKS = {
  "README.md": "/",
  "README.zh-CN.md": "/zh-CN/",
  ...Object.fromEntries(
    Object.entries(DOCUMENTS).map(([file, { path }]) => [file, path]),
  ),
};

const SCREENSHOTS = [
  "screenshot-overview-1280x800.png",
  "screenshot-pacing-1280x800.png",
  "screenshot-history-1280x800.png",
];

const COPY = {
  en: {
    htmlLang: "en",
    home: "/",
    other: { label: "简体中文", href: "/zh-CN/" },
    tagline: "See how much of every AI plan you have left, in one Chrome side panel.",
    install: "Add to Chrome",
    source: "View source",
    features: [
      ["One view", "Usage, credits, and balances from each provider are normalized into one compact Used or Left display."],
      ["Pace", "When a provider reports a full reset window, AI Limits compares consumption with elapsed time so you can see whether you are ahead or behind."],
      ["Local only", "Each provider is opt-in with its own Chrome permission. Usage is read directly from the provider and stored in your browser. There is no AI Limits server."],
    ],
    providersHeading: "Supported services",
    providersMore: "How each provider is read",
    nav: { privacy: "Privacy", providers: "Providers", faq: "FAQ", security: "Security", issues: "Report an issue", source: "GitHub" },
    disclaimer: "AI Limits is an independent open-source project by TiantianFlow. It is not affiliated with, endorsed by, or authorized by any supported provider, its parent company, or its affiliates.",
    shotAlt: [
      "AI Limits side panel showing subscription usage, reset timing, and pace indicators",
      "AI Limits pace view comparing quota use with elapsed time",
      "AI Limits local quota history graph",
    ],
    carousel: { label: "Screenshots", prev: "Previous screenshot", next: "Next screenshot", go: "Show screenshot" },
    notFound: ["Page not found", "That page does not exist.", "Go to the home page"],
    redirecting: "Redirecting to",
  },
  "zh-CN": {
    htmlLang: "zh-CN",
    home: "/zh-CN/",
    other: { label: "English", href: "/" },
    tagline: "在一个 Chrome 侧边栏中，查看每个 AI 订阅还剩多少用量。",
    install: "添加至 Chrome",
    source: "查看源代码",
    features: [
      ["统一视图", "将各服务的用量、Credits 和余额统一为紧凑的“已用”或“剩余”显示。"],
      ["用量节奏", "当服务提供完整的重置周期时，AI Limits 会将用量与已过时间比较，显示你是超前还是落后。"],
      ["仅在本地", "每个服务都需要单独启用并授予对应的 Chrome 权限。用量直接从服务读取并保存在你的浏览器中，AI Limits 没有服务器。"],
    ],
    providersHeading: "支持的服务",
    providersMore: "各服务的读取方式",
    nav: { privacy: "隐私（英文）", providers: "支持的服务", faq: "常见问题", security: "安全（英文）", issues: "报告问题", source: "GitHub" },
    disclaimer: "AI Limits 是 TiantianFlow 开发的独立开源项目，与任何受支持的服务商、其母公司或关联方不存在隶属、背书或授权关系。",
    shotAlt: [
      "AI Limits 侧边栏展示订阅用量、重置时间和用量节奏",
      "AI Limits 用量节奏视图，将配额消耗与已过时间比较",
      "AI Limits 本地配额历史图表",
    ],
    carousel: { label: "截图", prev: "上一张截图", next: "下一张截图", go: "显示截图" },
    notFound: ["页面不存在", "找不到该页面。", "返回首页"],
    redirecting: "正在跳转至",
  },
};

const PROVIDERS_HREF = { en: "/providers/", "zh-CN": "/zh-CN/providers/" };
const FAQ_HREF = { en: "/faq/", "zh-CN": "/zh-CN/faq/" };

export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** GitHub-style heading anchor so deep links match the repository view. */
export function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

/** Maps a link written for the repository to its place on the site. */
export function rewriteHref(href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("//")) {
    return href;
  }
  const [file, hash] = href.split("#");
  const page = PAGE_LINKS[file.replace(/^\.\//, "")];
  const target = page ?? `${REPOSITORY_URL}/blob/main/${file.replace(/^\.\//, "")}`;
  return hash ? `${target}#${hash}` : target;
}

function createMarkdown() {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  const defaultLink = md.renderer.rules.link_open ??
    ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    token.attrSet("href", rewriteHref(token.attrGet("href")));
    return defaultLink(tokens, index, options, env, self);
  };
  md.core.ruler.push("heading_ids", (state) => {
    const seen = new Map();
    state.tokens.forEach((token, index) => {
      if (token.type !== "heading_open") return;
      const base = slugify(state.tokens[index + 1].content);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      token.attrSet("id", count ? `${base}-${count}` : base);
    });
  });
  return md;
}

/** Reads the provider list from the README sentence that names all of them. */
export function readProviders(readme) {
  const match = readme.match(/supports [a-z-]+ providers: ([^\n]+?)\.\n/);
  if (!match) throw new Error("README.md no longer lists providers in the expected sentence");
  return match[1].split(/, (?:and )?/).map((name) => name.trim());
}

function layout({ lang, title, description, path, body }) {
  const copy = COPY[lang];
  const nav = copy.nav;
  const pageTitle = title ? `${title} · AI Limits` : "AI Limits";
  return `<!doctype html>
<html lang="${copy.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${SITE_ORIGIN}${path}">
<link rel="icon" href="/assets/icon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/icon-128.png">
<meta property="og:title" content="${escapeHtml(pageTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${SITE_ORIGIN}${path}">
<meta property="og:image" content="${SITE_ORIGIN}/assets/promo-440x280.png">
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<header class="bar">
  <a class="brand" href="${copy.home}"><img src="/assets/icon-32.png" width="24" height="24" alt="">AI Limits</a>
  <nav>
    <a href="${PROVIDERS_HREF[lang]}">${nav.providers}</a>
    <a href="${FAQ_HREF[lang]}">${nav.faq}</a>
    <a href="${copy.other.href}" lang="${copy.other.href === "/" ? "en" : "zh-CN"}">${copy.other.label}</a>
  </nav>
</header>
<main>
${body}
</main>
<footer class="foot">
  <nav>
    <a href="/privacy/">${nav.privacy}</a>
    <a href="${PROVIDERS_HREF[lang]}">${nav.providers}</a>
    <a href="${FAQ_HREF[lang]}">${nav.faq}</a>
    <a href="/security/">${nav.security}</a>
    <a href="/issues/">${nav.issues}</a>
    <a href="/source/">${nav.source}</a>
  </nav>
  <p>${escapeHtml(copy.disclaimer)}</p>
</footer>
</body>
</html>
`;
}

function landing(lang, providers) {
  const copy = COPY[lang];
  const shotDir = lang === "zh-CN" ? "/assets/zh-CN/" : "/assets/";
  const features = copy.features
    .map(([heading, text]) => `<div><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(text)}</p></div>`)
    .join("\n    ");
  const slides = SCREENSHOTS
    .map((file, index) =>
      `<li><img src="${shotDir}${file}" width="1280" height="800" alt="${escapeHtml(copy.shotAlt[index])}"${index ? ' loading="lazy"' : ""}></li>`)
    .join("\n      ");
  const dots = SCREENSHOTS
    .map((file, index) =>
      `<button type="button" aria-label="${escapeHtml(`${copy.carousel.go} ${index + 1}`)}"${index ? "" : ' aria-current="true"'}></button>`)
    .join("");
  const chips = providers.map((name) => `<li>${escapeHtml(name)}</li>`).join("");
  return layout({
    lang,
    title: "",
    description: copy.tagline,
    path: copy.home,
    body: `<section class="hero">
  <img src="/assets/icon-128.png" width="72" height="72" alt="">
  <h1>AI Limits</h1>
  <p class="tagline">${escapeHtml(copy.tagline)}</p>
  <p class="actions">
    <a class="button primary" href="${STORE_URL}">${copy.install}</a>
    <a class="button" href="${REPOSITORY_URL}">${copy.source}</a>
  </p>
</section>
<section class="carousel" aria-roledescription="carousel" aria-label="${escapeHtml(copy.carousel.label)}">
  <ul class="track" tabindex="0">
      ${slides}
  </ul>
  <div class="controls" hidden>
    <button type="button" class="prev" aria-label="${escapeHtml(copy.carousel.prev)}">‹</button>
    <div class="dots">${dots}</div>
    <button type="button" class="next" aria-label="${escapeHtml(copy.carousel.next)}">›</button>
  </div>
</section>
<script src="/assets/carousel.js" defer></script>
<section class="features">
    ${features}
</section>
<section class="providers">
  <h2>${escapeHtml(copy.providersHeading)} (${providers.length})</h2>
  <ul>${chips}</ul>
  <p><a href="${PROVIDERS_HREF[lang]}">${escapeHtml(copy.providersMore)} →</a></p>
</section>`,
  });
}

function documentPage(md, source, { path, lang }) {
  const html = md.render(source);
  const title = source.match(/^# (.+)$/m)?.[1] ?? "AI Limits";
  return layout({
    lang,
    title: title.replace(/^AI Limits\s*/, "") || title,
    description: lang === "zh-CN" ? `${title}。AI Limits Chrome 扩展。` : `${title}. AI Limits Chrome extension.`,
    path,
    body: `<article class="doc">\n${html}</article>`,
  });
}

export function redirectPage(path, target) {
  const href = escapeHtml(target);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${href}">
<link rel="canonical" href="${href}">
<title>AI Limits</title>
</head>
<body>
<p>${COPY.en.redirecting} <a href="${href}">${href}</a>.</p>
</body>
</html>
`;
}

function notFound() {
  const [title, text, link] = COPY.en.notFound;
  return layout({
    lang: "en",
    title,
    description: text,
    path: "/404.html",
    body: `<section class="hero"><h1>${title}</h1><p class="tagline">${text}</p><p class="actions"><a class="button primary" href="/">${link}</a></p></section>`,
  });
}

async function emit(path, html) {
  const file = path.endsWith("/") ? join(OUT, path, "index.html") : join(OUT, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}

export async function buildSite() {
  await rm(OUT, { recursive: true, force: true });
  const md = createMarkdown();
  const read = (file) => readFile(join(ROOT, file), "utf8");
  const providers = readProviders(await read("README.md"));

  await emit("/", landing("en", providers));
  await emit("/zh-CN/", landing("zh-CN", providers));
  for (const [file, page] of Object.entries(DOCUMENTS)) {
    await emit(page.path, documentPage(md, await read(file), page));
  }
  for (const [path, target] of Object.entries(REDIRECTS)) {
    await emit(path, redirectPage(path, target));
  }
  await emit("/404.html", notFound());
  await emit("/CNAME", `${new URL(SITE_ORIGIN).host}\n`);

  const assets = join(OUT, "assets");
  await mkdir(join(assets, "zh-CN"), { recursive: true });
  const store = join(ROOT, "store-assets", "chrome-web-store");
  for (const file of SCREENSHOTS) {
    await copyFile(join(store, file), join(assets, file));
    await copyFile(join(store, "zh_CN", file), join(assets, "zh-CN", file));
  }
  await copyFile(join(store, "small-promo-440x280.png"), join(assets, "promo-440x280.png"));
  await copyFile(join(ROOT, "public", "icons", "32.png"), join(assets, "icon-32.png"));
  await copyFile(join(ROOT, "public", "icons", "128.png"), join(assets, "icon-128.png"));
  await copyFile(join(ROOT, "site", "style.css"), join(assets, "style.css"));
  await copyFile(join(ROOT, "site", "carousel.js"), join(assets, "carousel.js"));
  return OUT;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await buildSite();
  console.log(`AI Limits site built in ${out}`);
}
