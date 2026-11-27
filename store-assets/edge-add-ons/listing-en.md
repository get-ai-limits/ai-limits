# Microsoft Edge Add-ons listing

This document describes AI Limits version 0.7.0 for Microsoft Edge Add-ons
(Partner Center). It is the paste-ready listing copy and reviewer material for
the Edge package built with `pnpm zip:edge`. It is not a claim that any provider
has approved the extension.

The Edge package runs the same code as the Chrome Web Store package. The
[Chrome Web Store pack](../chrome-web-store/listing-en.md) holds the full
permission and data-handling reference and the twenty-four-provider test
flow; read "Chrome" there as "Edge". The writing rules in
[`AGENTS.md`](../chrome-web-store/AGENTS.md) apply to this listing too.

## Package

- Upload `.output/ai-limits-0.7.0-edge.zip`, built and checked with
  `pnpm verify:zip && pnpm verify:targets`.
- Extension name and short description come from the package manifest
  (`manifest.name` and `manifest.descriptionEdge` in `locales/*.yml`). They can
  only change with a new package.

## Availability

- Visibility: Public
- Markets: All markets

## Properties

- Category: Productivity
- Website: https://get-ai-limits.com/
- Support contact: https://get-ai-limits.com/support/
- Mature content: No

## Privacy

### Single purpose description

AI Limits gives a user one Edge side panel for viewing current subscription usage as Used or Left, reset timing, pace, and local quota-history graphs across twenty-four supported services. Browser-session services use an account already signed in within the user's browser profile; API-key services use a key the user connects through guided setup.

### Permission justifications

Each entry is one Partner Center box. Optional permissions are requested only
when the user connects the provider that needs them.

- `storage`: Saves the user's preferences, provider order and visibility, provider access state, normalized usage snapshots, up to 30 days of local usage History, and for ChatGPT and Cursor a SHA-256 hash of each connected login's user ID on this device. API keys the user enters are saved locally in a separate record restricted to trusted extension contexts. Browser-session cookies and access credentials are never saved to disk, except the Cursor or ChatGPT sign-ins saved when the user adds a second account of that service (see `cookies`). Kimi's refresh tokens (current and the page's) and latest access token, and Gumloop's refresh token, latest ID token, user ID, and Firebase web API key, are the only credentials kept, and only in memory-only session storage until the browser exits, so background refresh can renew Kimi and Gumloop access.
- `alarms`: Schedules the background refresh about every 15 minutes, only while automatic refresh is on and at least one provider is connected.
- `sidePanel`: Shows the extension's only interface in the Edge side panel when the user selects the toolbar button.
- `declarativeNetRequestWithHostAccess`: One session rule removes the Origin header from the extension's own POST request to Warp's usage endpoint (https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo), because Warp refuses requests that carry an extension origin. It applies only to that URL, only to this extension's own background requests, and only after the user grants access to app.warp.dev. When the user adds a second Cursor or ChatGPT account, a session rule sets the Cookie header of the extension's own background request to cursor.com or chatgpt.com to the saved sign-in of the connection being read, only for that one request, and drops any cookie the site returns. For Cursor's dashboard requests, which Cursor accepts only from its own pages, it also sets the Origin header to https://cursor.com. No other request is changed.
- `scripting` (optional): Requested only when the user connects Kimi, Cursor, Grok, or Gumloop. Runs bundled, read-only code in that provider's own page to read the user's usage: Kimi's access_token and refresh_token storage entries, Gumloop's Firebase sign-in entry in the page's IndexedDB, or Cursor's, Grok's, and Gumloop's usage responses. The Kimi refresh token is sent only to Kimi's sign-in service (auth.kimi.com), and the Gumloop refresh token only to Google's Firebase token service that Gumloop uses (securetoken.googleapis.com), without cookies, to renew access. It may briefly open one inactive provider tab during Connect or manual Refresh and closes only the tab it opened. It never reads page text, prompts, or conversations.
- `cookies` (optional): Requested only when the user adds a second Cursor or ChatGPT account, and used only for cursor.com and chatgpt.com. The browser holds one sign-in per site, so the extension saves the current sign-in cookies (the site's named session cookie plus its other HttpOnly cookies, except bot protection) for the connection they belong to, removes them so the user can sign in to the next account, and opens the sign-in page. Saved sign-ins stay on the device in a record restricted to trusted extension contexts. They are sent only to the same site and deleted with their connection, on Delete all local data, or when this permission is removed. For 15 minutes after opening the sign-in page, the extension watches only for that site's sign-in cookie, to read the new account once it signs in. Once the new connection reads its account, its own sign-in is saved the same way, without signing the browser out, while the provider has more than one connection. It also reads that site's bot-protection cookies (Cloudflare `__cf_bm`, `cf_clearance`, `_cfuvid`, `__cflb`; ChatGPT `oai-did`) to send alongside a saved sign-in; those are not saved.
- Optional host permissions: Each provider's origin is requested only when the user clicks Connect on that provider, and is used only to read that provider's usage, plan, or balance. For self-hosted gateways (New API, LiteLLM, ClawRouter, sub2api, LLM Proxy), the extension asks only for the exact HTTPS origin, or the exact localhost port, that the user enters.

### Remote code

No. All code ships in the package.

### Data usage

Tick the same categories as the Chrome Web Store answers. The details behind
each answer are in the [Chrome Web Store pack](../chrome-web-store/listing-en.md#data-disclosure-answers):

- Personally identifiable information: Yes (narrowly handled account identifiers; see the Chrome pack)
- Health information: No
- Financial and payment information: Yes (provider-reported credit balances and spend only)
- Authentication information: Yes (provider API keys and sign-in sessions, sent only to that provider, or for Gumloop sign-in renewal to the Google Firebase token service Gumloop uses)
- Personal communications: No
- Location: No
- Web history: Yes (only whether a fixed provider tab is open; never stored or sent)
- User activity: No
- Website content: Yes (provider usage responses only; never page text, prompts, or conversations)

Certify that data is not sold, not used for unrelated purposes, and not used
for creditworthiness or lending.

### Privacy policy URL

https://get-ai-limits.com/privacy/

## Store listing: English

Upload the files in `store-assets/edge-add-ons/`. Every image is generated
from the production side-panel UI with representative fixture data; see
[`store-assets/README.md`](../README.md).

- Extension logo: `store-logo-300x300.png`
- Small promotional tile: `small-promo-440x280.png`
- Large promotional tile: none
- Screenshots, in order: `screenshot-overview-1280x800.png`,
  `screenshot-pacing-1280x800.png`, `screenshot-history-1280x800.png`,
  `screenshot-privacy-1280x800.png`
- YouTube video: none

### Short description

Track subscription usage, resets, pace, and local history for your connected AI providers in one Edge side panel.

## Description

<!-- This store field is plain text: paste everything below this line, up to the next heading. -->

Stop guessing how much of your AI plan is left. AI Limits shows the usage limits of your AI subscriptions and API accounts in one Edge side panel: what's left, when it resets, and whether you're on pace, before you hit a limit in the middle of your work.

WHY AI LIMITS
• Every plan in one panel: chat subscriptions, coding assistants, API credit balances, and self-hosted gateways side by side, instead of scattered across account pages.
• Used or Left: flip every meter to the view that makes sense to you, and see the plan name where the service reports it.
• Reset countdowns: see when each usage window refills, where the service reports a reset time, so you know whether to wait, slow down, or switch tools.
• Pace: for quota windows with a reliable reset time plus either a start time or window duration, a pace signal compares quota consumed with elapsed time, so you see early if you'll run out before the reset.
• History: open any quota window to see how usage climbed and reset, with up to 30 days kept on your device. Prepaid balances are charted too, with top-ups marked.
• Your layout: drag providers into the order you want, or hide one without disconnecting it. Hidden providers stay connected and keep refreshing.
• Automatic refresh about every 15 minutes in the background for most services, even with the panel closed.
• English and Simplified Chinese. The panel follows Edge's language or can be pinned in Settings.

24 SUPPORTED SERVICES
AI Limits supports 24 AI services: chat and coding subscriptions, API platforms with credits or balances, and self-hosted API gateways. Connect only the ones you use; every connection is opt-in and only gets the Edge access you approve for it. Subscription services use the account you're already signed in to in Edge, while API services use a key you provide through a guided setup.

See every supported service and what AI Limits shows for it:
https://get-ai-limits.com/providers/

PRIVATE BY DESIGN
• Stored locally: your usage history stays on your device and is never sent to the developer or anyone else. Requests go only to the services you connect and the sign-in services they use.
• AI Limits uses your sign-in session or API key only to fetch plan, usage, and balance data, and keeps only what it needs to show your limits. It never reads your prompts or conversations.
• No ads, no AI Limits account to create, no analytics or telemetry.
• Free and open source under the MIT license: https://get-ai-limits.com/source/

Questions, bugs, or a service you'd like supported: https://get-ai-limits.com/support/

AI Limits is an independent project by TiantianFlow. It is not affiliated with, endorsed by, or authorized by any of the connected service providers, their parent companies, or their affiliates.

## Search terms

Partner Center allows up to 7 terms of at most 30 characters each, 21 words in
total. They are not shown to users.

- AI usage limits
- usage tracker
- quota tracker
- rate limits
- API credits
- AI subscription
- side panel

## Notes for certification

<!-- This field is plain text: paste everything below this line, up to the end of the document. -->

AI Limits shows the user's own usage limits for AI services in the Edge side panel. Select the toolbar button to open it. Nothing is connected at install: First Run lists 24 opt-in providers, and each provider's site access is requested only when the reviewer clicks Connect.

No test account is supplied by the extension. To see real data, sign in to any supported subscription service in the same Edge profile (for example ChatGPT or Claude) and click Connect on it, or create a temporary read-only API key for an API service (for example OpenRouter or DeepSeek) and connect it through the guided setup. Without an account, the reviewer can still check First Run, Settings, the provider list, the permission prompts, and Delete all local data.

The extension sends requests only to the providers the user connects, plus Gumloop sign-in renewal to the Google Firebase token service (securetoken.googleapis.com) that Gumloop's own page uses. It has no backend, analytics, or remote code. The single declarativeNetRequest session rule only removes the Origin header from the extension's own request to Warp's usage endpoint, which Warp otherwise refuses.

Source code: https://get-ai-limits.com/source/ (MIT). Privacy policy: https://get-ai-limits.com/privacy/
