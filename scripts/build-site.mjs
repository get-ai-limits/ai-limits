// Builds the static get-ai-limits.com site into dist/site.
//
// The landing and providers pages are marketing pages written here. The
// privacy policy, FAQ, and security pages are rendered from the repository's
// Markdown documents at build time, so those stay the single source of truth.
// The short links (/issues, /source, ...) are redirect pages so the extension
// and store listing can point at URLs that survive a repository move.

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
  "PRIVACY.md": {
    path: "/privacy/",
    lang: "en",
    description: "How AI Limits handles your data: everything stays in your Chrome profile, with no AI Limits server, account, analytics, or telemetry.",
  },
  "FAQ.md": {
    path: "/faq/",
    lang: "en",
    description: "Answers about automatic refresh, History, API keys, and how AI Limits works with each AI service.",
  },
  "FAQ.zh-CN.md": {
    path: "/zh-CN/faq/",
    lang: "zh-CN",
    description: "关于 AI Limits 自动刷新、用量历史、API 密钥以及各 AI 服务连接方式的常见问题。",
  },
  "SECURITY.md": {
    path: "/security/",
    lang: "en",
    description: "How to report a security issue in AI Limits, and how saved API keys are protected.",
  },
};

/** Pages with an English and a Simplified Chinese version. */
const ALTERNATES = [
  { en: "/", "zh-CN": "/zh-CN/" },
  { en: "/providers/", "zh-CN": "/zh-CN/providers/" },
  { en: "/faq/", "zh-CN": "/zh-CN/faq/" },
];

const PROVIDERS_HREF = { en: "/providers/", "zh-CN": "/zh-CN/providers/" };
const FAQ_HREF = { en: "/faq/", "zh-CN": "/zh-CN/faq/" };

const PAGE_LINKS = {
  "README.md": "/",
  "README.zh-CN.md": "/zh-CN/",
  "SUPPORTED_PROVIDERS.md": PROVIDERS_HREF.en,
  "SUPPORTED_PROVIDERS.zh-CN.md": PROVIDERS_HREF["zh-CN"],
  ...Object.fromEntries(
    Object.entries(DOCUMENTS).map(([file, { path }]) => [file, path]),
  ),
};

const SCREENSHOTS = [
  "screenshot-overview-1280x800.png",
  "screenshot-pacing-1280x800.png",
  "screenshot-history-1280x800.png",
];

/**
 * The providers page, grouped by how each service connects. Names must match
 * the extension's provider catalog; the build test checks that every catalog
 * provider appears exactly once.
 */
export const PROVIDER_GROUPS = [
  {
    id: "subscriptions",
    providers: [
      ["ChatGPT", "Message limits and credits for your plan", "套餐的消息额度和 Credits"],
      ["Claude", "Usage limits, model-specific limits, and extra usage", "通用与模型专属用量限制，以及额外用量"],
      ["Kimi", "Subscription usage and Kimi Code limits", "订阅用量和 Kimi Code 限额"],
      ["Cursor", "Monthly limits, Grok Bot weekly usage, and extra credits", "月度限额、Grok Bot 每周用量和额外 Credits"],
      ["Grok", "Weekly or monthly SuperGrok usage pool", "SuperGrok 每周或每月用量池"],
      ["Mistral", "Month-to-date spend and available credits", "本月支出和可用额度"],
      ["Perplexity", "Recurring, purchased, and promotional credits", "周期、购买和赠送的额度"],
    ],
  },
  {
    id: "api",
    providers: [
      ["OpenAI", "API organization costs, usage, or credits", "API 组织费用、用量或额度"],
      ["OpenRouter", "Credit balance and API-key budget", "额度余额和 API 密钥预算"],
      ["DeepSeek", "Account balance", "账户余额"],
      ["Moonshot", "Platform balance", "开放平台余额"],
      ["GLM", "Coding Plan 5-hour and weekly allowances", "Coding Plan 5 小时和每周额度"],
      ["Droid", "5-hour, weekly, and monthly limits plus extra usage", "5 小时、每周和每月限额，以及额外用量"],
      ["Warp", "Included credits, reset time, and add-on credits", "套餐额度、重置时间和附加额度"],
      ["ElevenLabs", "Monthly credits and voice limits", "每月 Credits 和语音容量"],
      ["DeepInfra", "Monthly spend against your limit, or balance", "当月支出与消费上限，或余额"],
      ["Fireworks", "Spend over the last 30 days", "近 30 天支出"],
      ["GroqCloud", "Request and token rates", "请求和令牌速率"],
    ],
  },
  {
    id: "gateways",
    providers: [
      ["New API", "Quota left on each relay key", "每个中转密钥的剩余配额"],
      ["LiteLLM", "Virtual-key spend and budget", "虚拟密钥支出和预算"],
      ["sub2api", "Key quota, subscription windows, and balance", "密钥配额、订阅周期和余额"],
      ["ClawRouter", "Monthly budget or cost", "每月预算或费用"],
      ["LLM Proxy", "Remaining credential quota", "剩余凭据配额"],
    ],
  },
];

const COPY = {
  en: {
    htmlLang: "en",
    ogLocale: "en_US",
    home: "/",
    other: { label: "简体中文", href: "/zh-CN/" },
    title: "AI Limits – Track ChatGPT, Claude, Cursor and other AI usage limits in Chrome",
    description: "Free Chrome extension that shows usage, reset times, and pace for ChatGPT, Claude, Cursor, and 20 more AI services in one side panel. Private, local, and open source.",
    headline: "Know your AI limits before you hit them",
    lede: "AI Limits is a free Chrome extension that shows how much of every AI plan you have left, when it resets, and whether you’re on pace, for ChatGPT, Claude, Cursor, and 20 more services, in one side panel.",
    install: "Add to Chrome – it’s free",
    installShort: "Add to Chrome",
    badges: ["Free", "Open source", "No account", "No tracking"],
    stepsHeading: "Up and running in a minute",
    steps: [
      ["Add to Chrome", "Install AI Limits from the Chrome Web Store. It starts empty, with nothing connected."],
      ["Connect what you use", "Pick a service and approve its permission. Subscriptions use the account you’re already signed in to; API accounts use a key you paste."],
      ["Check at a glance", "Open the side panel to see what’s left. It refreshes about every 15 minutes in the background, even when the panel is closed."],
    ],
    featuresHeading: "Everything you need to pace your AI usage",
    features: [
      ["Every plan in one panel", "Chat subscriptions, coding assistants, API credit balances, and self-hosted gateways, side by side instead of scattered across account pages."],
      ["Used or Left", "Flip every meter to the view that makes sense to you, and see the current plan of each account."],
      ["Reset countdowns", "See when each usage window refills, so you know whether to wait, slow down, or switch to another tool."],
      ["Pace", "When a service reports a full reset window, AI Limits compares how much you’ve used with how much time has passed, so you see early if you’ll run out."],
      ["30 days of history", "Open any window to see how usage climbed and reset. Prepaid balances are charted too, with top-ups marked."],
      ["Your layout", "Drag services into the order you want, or hide one without disconnecting it. English and Simplified Chinese."],
    ],
    privacyHeading: "Private by design",
    privacyPoints: [
      "Usage is read straight from each service and stored in your browser. There is no AI Limits server.",
      "AI Limits reads usage and balances only, never your prompts or conversations.",
      "Each service is opt-in and asks for its own Chrome permission.",
      "No account, no ads, no analytics, no telemetry. The code is open source under the MIT license.",
    ],
    privacyMore: "Read the privacy policy",
    providersHeading: "Works with 23 AI services",
    providersMore: "See what AI Limits shows for each service",
    faqHeading: "Questions",
    faq: [
      ["Is AI Limits free?", "Yes. AI Limits is free and open source under the MIT license. There is no paid tier and no account to create."],
      ["Can AI Limits see my prompts or conversations?", "No. It reads only usage, limit, and balance information from each service. It does not read page text, prompts, conversations, or generated responses."],
      ["Where is my data stored?", "In your own Chrome profile. Usage History is kept for up to 30 days on your device and is never sent to the developer or anyone else. Disconnecting a service deletes its data."],
      ["Do I need to keep the side panel open?", "No. AI Limits refreshes about every 15 minutes in the background while Chrome is running, and shows the latest data when you open the panel."],
      ["Which browsers are supported?", "Google Chrome 116 or later on desktop."],
      ["My AI service isn’t supported. Can you add it?", "Open an issue on GitHub with the service you’d like to see, and include a link to its usage or billing page."],
    ],
    faqMore: "More answers in the full FAQ",
    faqIssue: "Request a service",
    ctaHeading: "Stop guessing what’s left",
    ctaText: "Free, private, and set up in a minute.",
    providersPage: {
      title: "Supported AI services",
      description: "AI Limits tracks usage limits, credits, and balances for 23 AI services in Chrome, including ChatGPT, Claude, Cursor, Grok, OpenAI, OpenRouter, and DeepSeek.",
      lede: "Connect only the services you use. Each one is opt-in and asks for its own Chrome permission.",
      groups: {
        subscriptions: ["Subscriptions", "Sign in to the service in Chrome as usual. AI Limits uses that session; there is nothing to paste."],
        api: ["API accounts", "Paste an API key from the service’s dashboard. A guided setup shows where to create one."],
        gateways: ["Self-hosted gateways", "Add the URL of your own instance and a key. You can connect several instances."],
      },
      details: "Connection details and known limitations for each service are in the",
      detailsLink: "technical notes on GitHub",
      stop: ".",
      missing: "Missing a service you use?",
      missingLink: "Request it",
    },
    nav: { privacy: "Privacy", providers: "Services", faq: "FAQ", security: "Security", issues: "Report an issue", source: "GitHub" },
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
    ogLocale: "zh_CN",
    home: "/zh-CN/",
    other: { label: "English", href: "/" },
    title: "AI Limits – 在 Chrome 中查看 ChatGPT、Claude、Cursor 等 AI 用量限额",
    description: "免费的 Chrome 扩展，在一个侧边栏中查看 ChatGPT、Claude、Cursor 等 23 个 AI 服务的用量、重置时间和用量节奏。数据只保存在本地，开源免费。",
    headline: "用完之前，先知道还剩多少",
    lede: "AI Limits 是一款免费的 Chrome 扩展。在一个侧边栏里查看 ChatGPT、Claude、Cursor 等 23 个 AI 服务还剩多少用量、何时重置，以及当前用量节奏是否过快。",
    install: "免费添加至 Chrome",
    installShort: "添加至 Chrome",
    badges: ["免费", "开源", "无需注册", "无追踪"],
    stepsHeading: "一分钟即可上手",
    steps: [
      ["添加至 Chrome", "从 Chrome 应用商店安装 AI Limits。安装后默认为空，不会自动连接任何服务。"],
      ["连接你在用的服务", "选择服务并授予对应权限。订阅类服务直接使用你已登录的账号；API 类服务粘贴一个密钥即可。"],
      ["随时一眼看清", "打开侧边栏即可查看剩余用量。即使关闭侧边栏，后台也会约每 15 分钟自动刷新一次。"],
    ],
    featuresHeading: "合理安排 AI 用量所需的一切",
    features: [
      ["所有套餐，一个面板", "聊天订阅、编程助手、API 余额和自建网关并排显示，不用再挨个打开账户页面。"],
      ["已用或剩余", "所有用量条都可以在“已用”和“剩余”之间切换，并显示每个账号的当前套餐。"],
      ["重置倒计时", "查看每个用量周期何时恢复，决定是等一等、放慢节奏，还是换个工具。"],
      ["用量节奏", "当服务提供完整的重置周期时，AI Limits 会比较已用量与已过时间，提前提醒你是否会在重置前用完。"],
      ["30 天用量历史", "打开任一用量周期即可查看用量的上升与重置。预付费余额同样绘制成图，并标出充值。"],
      ["按你的习惯排列", "拖动调整服务顺序，或在不断开连接的情况下隐藏某个服务。支持简体中文和英文。"],
    ],
    privacyHeading: "隐私优先",
    privacyPoints: [
      "用量直接从各服务读取，并保存在你的浏览器中。AI Limits 没有服务器。",
      "AI Limits 只读取用量和余额，绝不读取你的提示词或对话。",
      "每个服务都需要单独启用，并单独申请 Chrome 权限。",
      "无需账号，没有广告、分析或遥测。代码以 MIT 许可证开源。",
    ],
    privacyMore: "阅读隐私政策（英文）",
    providersHeading: "支持 23 个 AI 服务",
    providersMore: "查看 AI Limits 为每个服务显示的内容",
    faqHeading: "常见问题",
    faq: [
      ["AI Limits 免费吗？", "免费。AI Limits 以 MIT 许可证开源，没有付费版本，也无需注册账号。"],
      ["AI Limits 能看到我的提示词或对话吗？", "不能。它只读取各服务的用量、限额和余额信息，不会读取页面文字、提示词、对话或生成的回复。"],
      ["我的数据保存在哪里？", "保存在你自己的 Chrome 配置文件中。用量历史最多在本地保留 30 天，绝不会发送给开发者或任何其他人。断开某个服务会删除它的数据。"],
      ["需要一直打开侧边栏吗？", "不需要。只要 Chrome 在运行，AI Limits 就会在后台约每 15 分钟刷新一次，打开侧边栏时显示最新数据。"],
      ["支持哪些浏览器？", "桌面版 Google Chrome 116 或更高版本。"],
      ["我用的 AI 服务还不支持，可以添加吗？", "欢迎在 GitHub 上提交 Issue，写明你希望支持的服务，并附上它的用量或账单页面链接。"],
    ],
    faqMore: "查看完整常见问题",
    faqIssue: "申请支持新服务",
    ctaHeading: "别再猜还剩多少用量",
    ctaText: "免费、注重隐私，一分钟即可设置完成。",
    providersPage: {
      title: "支持的 AI 服务",
      description: "AI Limits 在 Chrome 中查看 23 个 AI 服务的用量限额、额度和余额，包括 ChatGPT、Claude、Cursor、Grok、OpenAI、OpenRouter 和 DeepSeek。",
      lede: "只连接你在用的服务。每个服务都需要单独启用，并单独申请 Chrome 权限。",
      groups: {
        subscriptions: ["订阅服务", "像平常一样在 Chrome 中登录该服务即可。AI Limits 使用现有登录状态，无需粘贴任何内容。"],
        api: ["API 账户", "从服务后台复制一个 API 密钥粘贴进来。引导页面会告诉你在哪里创建。"],
        gateways: ["自建网关", "填写你自己实例的网址和密钥，可以同时连接多个实例。"],
      },
      details: "各服务的连接方式和已知限制，请参阅",
      detailsLink: "GitHub 上的技术说明",
      stop: "。",
      missing: "没有找到你在用的服务？",
      missingLink: "提交申请",
    },
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

const TECHNICAL_NOTES = {
  en: `${REPOSITORY_URL}/blob/main/SUPPORTED_PROVIDERS.md`,
  "zh-CN": `${REPOSITORY_URL}/blob/main/SUPPORTED_PROVIDERS.zh-CN.md`,
};

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

/** JSON for an inline script element; `<` is escaped so it cannot close the tag. */
function jsonLd(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
}

function alternateLinks(path) {
  const pair = ALTERNATES.find((entry) => entry.en === path || entry["zh-CN"] === path);
  if (!pair) return "";
  return [
    `<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}${pair.en}">`,
    `<link rel="alternate" hreflang="zh-CN" href="${SITE_ORIGIN}${pair["zh-CN"]}">`,
    `<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}${pair.en}">`,
  ].join("\n");
}

function layout({ lang, title, description, path, body, head = "", noindex = false }) {
  const copy = COPY[lang];
  const nav = copy.nav;
  const ogImage = `${SITE_ORIGIN}/assets/${lang === "zh-CN" ? "zh-CN/" : ""}${SCREENSHOTS[0]}`;
  return `<!doctype html>
<html lang="${copy.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${SITE_ORIGIN}${path}">`}
${alternateLinks(path)}
<link rel="icon" href="/assets/icon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/icon-128.png">
<meta name="theme-color" content="#2357d8">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AI Limits">
<meta property="og:locale" content="${copy.ogLocale}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${SITE_ORIGIN}${path}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="800">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/assets/style.css">
${head}
</head>
<body>
<header class="bar">
  <a class="brand" href="${copy.home}"><img src="/assets/icon-32.png" width="24" height="24" alt="">AI Limits</a>
  <nav>
    <a href="${PROVIDERS_HREF[lang]}">${nav.providers}</a>
    <a href="${FAQ_HREF[lang]}">${nav.faq}</a>
    <a href="${copy.other.href}" lang="${copy.other.href === "/" ? "en" : "zh-CN"}">${copy.other.label}</a>
    <a class="button primary small" href="${STORE_URL}">${copy.installShort}</a>
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

function ctaBand(copy) {
  return `<section class="cta">
  <h2>${escapeHtml(copy.ctaHeading)}</h2>
  <p>${escapeHtml(copy.ctaText)}</p>
  <p class="actions"><a class="button primary" href="${STORE_URL}">${escapeHtml(copy.install)}</a></p>
</section>`;
}

function landing(lang, providers) {
  const copy = COPY[lang];
  const shotDir = lang === "zh-CN" ? "/assets/zh-CN/" : "/assets/";
  const slides = SCREENSHOTS
    .map((file, index) =>
      `<li><img src="${shotDir}${file}" width="1280" height="800" alt="${escapeHtml(copy.shotAlt[index])}"${index ? ' loading="lazy"' : ""}></li>`)
    .join("\n      ");
  const dots = SCREENSHOTS
    .map((file, index) =>
      `<button type="button" aria-label="${escapeHtml(`${copy.carousel.go} ${index + 1}`)}"${index ? "" : ' aria-current="true"'}></button>`)
    .join("");
  const badges = copy.badges.map((badge) => `<li>${escapeHtml(badge)}</li>`).join("");
  const steps = copy.steps
    .map(([heading, text]) => `<li><h3>${escapeHtml(heading)}</h3><p>${escapeHtml(text)}</p></li>`)
    .join("\n    ");
  const features = copy.features
    .map(([heading, text]) => `<div><h3>${escapeHtml(heading)}</h3><p>${escapeHtml(text)}</p></div>`)
    .join("\n    ");
  const privacy = copy.privacyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("\n    ");
  const chips = providers.map((name) => `<li>${escapeHtml(name)}</li>`).join("");
  const faq = copy.faq
    .map(([question, answer]) => `<details><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`)
    .join("\n  ");
  const structured = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "AI Limits",
      description: copy.description,
      url: `${SITE_ORIGIN}${copy.home}`,
      applicationCategory: "BrowserApplication",
      operatingSystem: "Google Chrome",
      downloadUrl: STORE_URL,
      installUrl: STORE_URL,
      image: `${SITE_ORIGIN}${shotDir}${SCREENSHOTS[0]}`,
      inLanguage: copy.htmlLang,
      license: "https://opensource.org/licenses/MIT",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: copy.faq.map(([question, answer]) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    },
  ];
  return layout({
    lang,
    title: copy.title,
    description: copy.description,
    path: copy.home,
    head: structured.map(jsonLd).join("\n"),
    body: `<section class="hero">
  <img src="/assets/icon-128.png" width="72" height="72" alt="">
  <h1>${escapeHtml(copy.headline)}</h1>
  <p class="tagline">${escapeHtml(copy.lede)}</p>
  <p class="actions">
    <a class="button primary" href="${STORE_URL}">${escapeHtml(copy.install)}</a>
  </p>
  <ul class="badges">${badges}</ul>
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
<section class="section">
  <h2>${escapeHtml(copy.stepsHeading)}</h2>
  <ol class="steps">
    ${steps}
  </ol>
</section>
<section class="section">
  <h2>${escapeHtml(copy.featuresHeading)}</h2>
  <div class="features">
    ${features}
  </div>
</section>
<section class="section providers">
  <h2>${escapeHtml(copy.providersHeading)}</h2>
  <ul>${chips}</ul>
  <p><a href="${PROVIDERS_HREF[lang]}">${escapeHtml(copy.providersMore)} →</a></p>
</section>
<section class="section privacy">
  <h2>${escapeHtml(copy.privacyHeading)}</h2>
  <ul>
    ${privacy}
  </ul>
  <p><a href="/privacy/">${escapeHtml(copy.privacyMore)} →</a></p>
</section>
<section class="section faq">
  <h2>${escapeHtml(copy.faqHeading)}</h2>
  ${faq}
  <p><a href="${FAQ_HREF[lang]}">${escapeHtml(copy.faqMore)} →</a> · <a href="/issues/">${escapeHtml(copy.faqIssue)} →</a></p>
</section>
${ctaBand(copy)}`,
  });
}

function providersPage(lang) {
  const copy = COPY[lang];
  const page = copy.providersPage;
  const column = lang === "zh-CN" ? 2 : 1;
  const groups = PROVIDER_GROUPS.map(({ id, providers }) => {
    const [heading, text] = page.groups[id];
    const rows = providers
      .map((row) => `<li><strong>${escapeHtml(row[0])}</strong><span>${escapeHtml(row[column])}</span></li>`)
      .join("\n    ");
    return `<section class="section group" id="${id}">
  <h2>${escapeHtml(heading)} <span class="count">${providers.length}</span></h2>
  <p class="muted">${escapeHtml(text)}</p>
  <ul class="service-list">
    ${rows}
  </ul>
</section>`;
  }).join("\n");
  return layout({
    lang,
    title: `${page.title} · AI Limits`,
    description: page.description,
    path: PROVIDERS_HREF[lang],
    body: `<section class="hero compact">
  <h1>${escapeHtml(page.title)}</h1>
  <p class="tagline">${escapeHtml(page.lede)}</p>
</section>
${groups}
<p class="muted note">${escapeHtml(page.details)} <a href="${TECHNICAL_NOTES[lang]}">${escapeHtml(page.detailsLink)}</a>${page.stop} ${escapeHtml(page.missing)} <a href="/issues/">${escapeHtml(page.missingLink)} →</a></p>
${ctaBand(copy)}`,
  });
}

function documentPage(md, source, { path, lang, description }) {
  const html = md.render(source);
  const heading = source.match(/^# (.+)$/m)?.[1] ?? "AI Limits";
  const title = heading.startsWith("AI Limits") ? heading : `${heading} · AI Limits`;
  return layout({
    lang,
    title,
    description,
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
    title: `${title} · AI Limits`,
    description: text,
    path: "/404.html",
    noindex: true,
    body: `<section class="hero"><h1>${title}</h1><p class="tagline">${text}</p><p class="actions"><a class="button primary" href="/">${link}</a></p></section>`,
  });
}

/** Every indexable page, for sitemap.xml. */
export function sitemapPaths() {
  return [
    "/",
    "/zh-CN/",
    PROVIDERS_HREF.en,
    PROVIDERS_HREF["zh-CN"],
    ...Object.values(DOCUMENTS).map(({ path }) => path),
  ];
}

function sitemap() {
  const urls = sitemapPaths()
    .map((path) => `  <url><loc>${SITE_ORIGIN}${path}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
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
  await emit(PROVIDERS_HREF.en, providersPage("en"));
  await emit(PROVIDERS_HREF["zh-CN"], providersPage("zh-CN"));
  for (const [file, page] of Object.entries(DOCUMENTS)) {
    await emit(page.path, documentPage(md, await read(file), page));
  }
  for (const [path, target] of Object.entries(REDIRECTS)) {
    await emit(path, redirectPage(path, target));
  }
  await emit("/404.html", notFound());
  await emit("/sitemap.xml", sitemap());
  await emit("/robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`);
  await emit("/CNAME", `${new URL(SITE_ORIGIN).host}\n`);

  const assets = join(OUT, "assets");
  await mkdir(join(assets, "zh-CN"), { recursive: true });
  const store = join(ROOT, "store-assets", "chrome-web-store");
  for (const file of SCREENSHOTS) {
    await copyFile(join(store, file), join(assets, file));
    await copyFile(join(store, "zh_CN", file), join(assets, "zh-CN", file));
  }
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
