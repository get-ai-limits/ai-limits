# Writing the Chrome Web Store listing

Read this before changing `listing-en.md`, `listing-zh_CN.md`, the store
artwork, or the manifest description. It collects the Chrome Web Store rules
that apply to AI Limits' listing, plus the project's own conventions. Rules
marked **policy** can get the item rejected or taken down; the rest are
recommendations.

Sources (checked 2026-11-02; when two pages disagree, the newer program
policies page wins):

- [Program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements/)
- [Creating a great listing page](https://developer.chrome.com/docs/webstore/best-listing)
- [Spam policy FAQ](https://developer.chrome.com/docs/webstore/program-policies/spam-faq)
- [Impersonation and intellectual property](https://developer.chrome.com/docs/webstore/program-policies/impersonation-and-intellectual-property)
- [Misleading or unexpected behavior](https://developer.chrome.com/docs/webstore/program-policies/unexpected-behavior)
- [Complete your listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [User data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Troubleshooting violations](https://developer.chrome.com/docs/webstore/troubleshooting)

## Fields and where their text lives

| Store field | Source in this repo | Limits and format |
| --- | --- | --- |
| Title | `manifest.name` in `locales/*.yml` | Clear, short, unique. No keywords added for search. |
| Summary | `manifest.description` in `locales/*.yml`, copied verbatim under "Short description" | At most 132 characters, plain text. Changing it needs an extension release; the dashboard cannot edit it. |
| Detailed description | "Detailed description" / "详细说明" sections | Plain text. Paste everything below the HTML comment up to the next heading. |
| Single purpose | "Single purpose" / "单一用途" sections | Plain text, no Markdown. |
| Permission justifications | "Permission justifications" sections | One entry per permission. |
| Privacy practices | "Data-disclosure answers" sections | Must match `PRIVACY.md` and real behavior. |
| Homepage, support, privacy policy URLs | "Store configuration" | `https://get-ai-limits.com/`, `/support/`, `/privacy/`. The privacy URL goes in the dashboard's privacy field, never only in the description. |
| Screenshots, promo tile | `store-assets/chrome-web-store/` (`zh_CN/` for Chinese) | 1 to 5 screenshots at 1280×800; small promo tile 440×280. Regenerate with `pnpm assets:store`. |

## Content rules

1. **Accurate and current (policy).** The title, description, screenshots,
   and promo images must not be misleading, inaccurate, incomplete, or out of
   date. Every claim must hold for every supported service, or say where it
   does not ("most services", "where the service reports it"). Check claims
   against `PRIVACY.md`, `FAQ.md`, and `SUPPORTED_PROVIDERS.md`.
2. **State the functionality directly (policy).** A reader must understand
   what the extension does before installing it. Open with one overview
   paragraph, then a short list of main features. List every major feature;
   an action the listing does not mention is a takedown reason.
3. **No keyword spam (policy).** No lists of sites, brands, or keywords
   without added value. Keep any one keyword (other than the product name)
   under five uses. A list of more than five brands is spam, so the detailed
   description never names provider brands: it states the count and links to
   `https://get-ai-limits.com/providers/`. `scripts/publication-contract.mjs`
   enforces this.
4. **No implied endorsement (policy).** Never suggest a provider authorizes,
   endorses, or produces AI Limits. Keep the non-affiliation sentence at the
   end of both descriptions. Provider logos appear only inside the real product UI in screenshots, never as standalone artwork in the promo tile.
5. **No status or superlative claims (policy).** No "Editor's Choice",
   "Number One", "best", "fastest", or comparisons with other extensions, in
   text or images.
6. **No unattributed testimonials (policy).** Don't quote users unless the
   quote is attributed. Never rate or review our own item, and never offer
   incentives for installs or reviews.
7. **Privacy claims match the disclosures (policy).** The description, the
   dashboard privacy answers, `PRIVACY.md`, and the code must agree. Avoid
   absolutes that the disclosures contradict: AI Limits does handle sign-in
   sessions, API keys, and account labels, so say what it keeps and what it
   never reads (prompts, conversations), not that it reads "only usage".
   A privacy policy is required even though data stays local.
8. **Limited Use statement.** Required only for data received from Google
   APIs. AI Limits uses none today; add the statement to the site if that
   changes.
9. **Screenshots show the current version (policy).** Regenerate the artwork
   whenever the UI, the provider count, or copy shown in it changes. Use the
   full 1280×800 frame, keep text short, and keep the icon, screenshots, and
   promo tile visually consistent.
10. **Locales say the same thing.** The Chinese listing may reword, but must
    not add or drop features. Don't publish a separate item per language.
11. **Single purpose.** Keep the single-purpose text narrow and matching the
    description: one side panel for AI usage, resets, pace, and local
    History.

## Project conventions

- Store fields are plain text: use `•` bullets and uppercase section labels,
  never `**bold**`, backticks, or Markdown links in pasted sections.
- Point URLs at `get-ai-limits.com` short links, never at GitHub directly,
  so a repository move needs no listing edit.
- Write the counted provider claim as "AI Limits supports N AI services" /
  "AI Limits 支持 N 个 AI 服务"; the contract checks N against the catalog.
- After any listing change, run `pnpm verify:publication`, and hand the
  maintainer a paste-ready copy of the changed fields. The maintainer updates
  the dashboard by hand.
