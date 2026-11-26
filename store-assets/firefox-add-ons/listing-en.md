# Firefox Add-ons listing

This document describes AI Limits version 0.6.1 for Firefox Add-ons (AMO). It
is the paste-ready listing copy and reviewer material for the Firefox package
built with `pnpm zip:firefox`. It is not a claim that any provider has approved
the extension.

The Firefox package runs the same code as the Chrome Web Store package, except
that the panel opens as a Firefox sidebar and the API-key and saved sign-in
records are not restricted with `storage.setAccessLevel`, which Firefox lacks. The
[Chrome Web Store pack](../chrome-web-store/listing-en.md) holds the full
permission and data-handling reference and the twenty-four-provider test
flow; read "Chrome side panel" there as "Firefox sidebar". The writing rules in
[`AGENTS.md`](../chrome-web-store/AGENTS.md) apply to this listing too.

## Upload

- Add-on file: `.output/ai-limits-0.6.1-firefox.zip`, built and checked with
  `pnpm verify:zip && pnpm verify:targets`.
- Compatibility: Firefox for desktop only. Leave Firefox for Android
  unchecked; Android has no sidebar.
- Source code: Yes. Upload `.output/ai-limits-0.6.1-sources.zip`. The build
  output is bundled and minified, not obfuscated.
- The add-on ID `ai-limits@get-ai-limits.com` is permanent. Never change it.
- At install, Firefox shows the data collection declared in the manifest
  (`authenticationInfo`, required). It must stay consistent with the privacy
  policy below.

## Basic information

- Name: AI Limits
- Add-on URL: https://addons.mozilla.org/firefox/addon/ai-limits/
- Categories: Alerts & Updates. Pick a second category only if one fits
  better in the current AMO list.
- Tags: AMO offers only a fixed list. Pick productivity, plus any other
  listed tag that fits.
- Support website: https://get-ai-limits.com/support/
- Homepage: https://get-ai-limits.com/
- Support email: leave empty
- License: MIT License
- This add-on is experimental: No
- This add-on requires payment, non-free services or software, or additional
  hardware: No

### Summary

AMO pre-fills the summary from the manifest (`manifest.descriptionFirefox` in
`locales/en.yml`). Keep it identical:

Track subscription usage, resets, pace, and local history for your connected AI providers in one Firefox sidebar.

## Description

<!-- Paste everything below this line, up to the next heading. -->

Stop guessing how much of your AI plan is left. AI Limits shows the usage limits of your AI subscriptions and API accounts in one Firefox sidebar: what's left, when it resets, and whether you're on pace, before you hit a limit in the middle of your work.

WHY AI LIMITS
• Every plan in one panel: chat subscriptions, coding assistants, API credit balances, and self-hosted gateways side by side, instead of scattered across account pages.
• Used or Left: flip every meter to the view that makes sense to you, and see the plan name where the service reports it.
• Reset countdowns: see when each usage window refills, where the service reports a reset time, so you know whether to wait, slow down, or switch tools.
• Pace: for quota windows with a reliable reset time plus either a start time or window duration, a pace signal compares quota consumed with elapsed time, so you see early if you'll run out before the reset.
• History: open any quota window to see how usage climbed and reset, with up to 30 days kept on your device. Prepaid balances are charted too, with top-ups marked.
• Your layout: drag providers into the order you want, or hide one without disconnecting it. Hidden providers stay connected and keep refreshing.
• Automatic refresh about every 15 minutes in the background for most services, even with the sidebar closed.
• English and Simplified Chinese. The sidebar follows Firefox's language or can be pinned in Settings.

24 SUPPORTED SERVICES
AI Limits supports 24 AI services: chat and coding subscriptions, API platforms with credits or balances, and self-hosted API gateways. Connect only the ones you use; every connection is opt-in and only gets the Firefox access you approve for it. Subscription services use the account you're already signed in to in Firefox, while API services use a key you provide through a guided setup.

See every supported service and what AI Limits shows for it:
https://get-ai-limits.com/providers/

WHAT IT SENDS, AND WHERE
• Requests go only to the services you connect. Your sign-in session or API key for a service is sent only to that service (or the sign-in service it uses to renew a session), to fetch its plan, usage, and balance data. That is why Firefox asks you to allow authentication information when you install.
• Stored locally: your usage history stays on your device and is never sent to the developer or anyone else. AI Limits never reads your prompts or conversations.
• No ads, no AI Limits account to create, no analytics or telemetry.
• Free and open source under the MIT license: https://get-ai-limits.com/source/

Questions, bugs, or a service you'd like supported: https://get-ai-limits.com/support/

AI Limits is an independent project by TiantianFlow. It is not affiliated with, endorsed by, or authorized by any of the connected service providers, their parent companies, or their affiliates.

## Screenshots

Upload the files in `store-assets/firefox-add-ons/` in this order, with these
captions. Every image is generated from the production UI with representative
fixture data; see [`store-assets/README.md`](../README.md).

1. `screenshot-overview-1280x800.png`: Every connected service in one sidebar, as Used or Left.
2. `screenshot-pacing-1280x800.png`: Reset timing and a pace signal for each quota window.
3. `screenshot-history-1280x800.png`: Local usage History for each quota window.
4. `screenshot-privacy-1280x800.png`: Per-service connections, refresh controls, and local data deletion.

## Privacy policy

<!-- Tick "This add-on has a privacy policy" and paste everything below this line, up to the next heading. -->

AI Limits privacy policy (summary). The full policy is at https://get-ai-limits.com/privacy/

AI Limits is a locally running browser extension by TiantianFlow. It has no backend server, no AI Limits account, and no analytics, telemetry, or advertising. Nothing is sent to the developer.

What it accesses: only after you connect a service and approve its site access, AI Limits reads that service's plan, quota, usage, reset time, credit, and balance data. For services you are signed in to, it uses your existing sign-in session with that service. For API services, it uses an API key you create and enter. For OpenRouter, it also reads the promotional-credit amounts from your signed-in openrouter.ai Credits page.

Where data goes: your sign-in session or API key for a service is sent only to that same service, to fetch your usage. The one exception is Gumloop: its refresh token goes to Google's Firebase token service, which Gumloop's own page uses to renew its sign-in. AI Limits never sends it anywhere else. Apart from that OpenRouter credit amount, it never reads page text, prompts, conversations, or generated responses.

What it stores, on your device only: your settings, provider order, the address and label you give any self-hosted gateway, normalized usage snapshots, up to 30 days of usage History per connection, and for ChatGPT and Cursor a SHA-256 hash of each connected login's user ID. API keys you enter are stored in Firefox's extension storage without operating-system keychain encryption, so anyone with access to your Firefox profile may be able to read them. Sign-in cookies and session credentials are never stored on disk, with one exception: when you add a second Cursor or ChatGPT account, AI Limits asks for the optional cookies permission and saves each of those accounts' sign-in cookie on your device, like API keys without operating-system keychain encryption. It sends that cookie only to the same site, and deletes it when you disconnect that account, when it expires, when you use Delete all local data, or when you remove the permission. Kimi's refresh tokens (current and the page's) and latest access token, and Gumloop's refresh token, latest ID token, user ID, and Firebase web API key, are the only credentials kept, and only in memory-only session storage until Firefox exits, so background refresh can renew Kimi and Gumloop access.

Your controls: disconnect any service, turn off automatic refresh, or use Delete all local data in Settings at any time. Uninstalling the extension removes its local data.

Data is never sold, and is never shared with the developer, advertisers, data brokers, or anyone other than the service it belongs to.

Contact: https://get-ai-limits.com/support/

## Notes to reviewer

<!-- Paste everything below this line, up to the end of the document. -->

AI Limits shows the user's own usage limits for AI services in a Firefox sidebar. Click the toolbar button to toggle the sidebar. Nothing is connected at install: First Run lists 24 opt-in providers, and each provider's host permission is requested only when the user clicks Connect on it.

Building from source: use Node 24 and the pnpm version pinned in package.json (via Corepack), then run: pnpm install --frozen-lockfile && pnpm zip:firefox. The output is .output/firefox-mv3, which matches the uploaded package. The build uses WXT and Vite; nothing is obfuscated.

Test accounts: none are supplied by the extension. To see real data, sign in to any supported subscription service in the same Firefox profile (for example ChatGPT or Claude) and click Connect on it, or create a temporary read-only API key for an API service (for example OpenRouter or DeepSeek) and connect it through the guided setup. Without an account you can still check First Run, Settings, the provider list, the permission prompts, and Delete all local data.

Data collection: the manifest declares authenticationInfo as required because the user's sign-in session or API key for a service is sent to that same service to read usage. For Gumloop, its refresh token also goes to the Google Firebase token service Gumloop uses. After the user adds a second Cursor or ChatGPT account, each such account's saved sign-in cookie is kept in local extension storage and sent only to that same site. Nothing is sent to the developer, and there is no remote code.

Injected code: for Kimi, Cursor, Grok, and Gumloop, scripting.executeScript runs a bundled read-only function in that provider's own page (MAIN world) to read usage responses, Kimi's access_token and refresh_token storage entries, or Gumloop's Firebase sign-in entry in IndexedDB. The Kimi refresh token is sent only to Kimi's sign-in service (auth.kimi.com), and the Gumloop refresh token only to Google's Firebase token service that Gumloop uses (securetoken.googleapis.com), without cookies, to renew access. During Connect or manual Refresh it may open one inactive provider tab and closes only that tab.

declarativeNetRequest: one session rule removes the Origin header from the extension's own POST to https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo, because Warp refuses requests carrying an extension origin. It is active only after the user grants app.warp.dev access. When the user adds a second Cursor or ChatGPT account, a session rule sets the Cookie header of the extension's own background request to cursor.com or chatgpt.com to that connection's saved sign-in, only for that one request, and drops any cookie the site returns.

cookies (optional): requested only when the user adds a second Cursor or ChatGPT account, and used only for cursor.com and chatgpt.com. The extension saves the current sign-in cookie for its connection in local extension storage and removes it from the browser, so the user can sign in to the next account. It then opens the sign-in page. For 15 minutes after that, it watches only for that site's sign-in cookie, to read the new account once it signs in. A saved sign-in is sent only to the same site and deleted when its connection is disconnected, when it expires, on Delete all local data, or when the permission is removed. It also reads that site's bot-protection cookies (Cloudflare `__cf_bm`, `cf_clearance`, `_cfuvid`, `__cflb`; ChatGPT `oai-did`) to send alongside a saved sign-in; those are not saved.

Firefox has no storage.setAccessLevel, so unlike the Chromium build the API-key record and the saved Cursor/ChatGPT sign-in record are not restricted with it. The extension declares no content scripts.
