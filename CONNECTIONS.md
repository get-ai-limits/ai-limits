# How AI Limits connects

Details behind the short notes in the AI Limits panel: how each service is read, what is stored, and when a tab may open. For what data AI Limits keeps, see the [privacy policy](PRIVACY.md).

## General

### Connecting

Connect asks for permission for that provider only, then attempts an authenticated read. Nothing is pre-detected, and credentials are not stored with normalized usage.

### Automatic refresh

Checks connected providers about every 15 minutes. Scheduled refresh stays non-interactive and never takes over the browser. Manual Refresh in the header updates every provider right away.

### Hide used-up plans

Moves a plan off the Overview while every one of its usage pools is at its limit and no extra credits or spend are left. A pool is blocked when any of its windows is at 100%. The plan comes back when a limit resets. Hidden plans stay connected and keep refreshing, and a plan whose last refresh failed is never hidden.

### Language

English and Simplified Chinese only. Other browser languages fall back to English. The browser’s own menus and the extension name stay in the browser’s language.

### Disconnecting

Disconnecting deletes that connection's saved credentials, configuration, usage, and history right away. Removing the browser's site permission can be delayed, and is skipped while another connection to the same site still needs it. Delete all local data in Settings removes everything at once; there is no cloud copy.

### Adding another account (Cursor, ChatGPT)

A browser holds one sign-in per site, so AI Limits keeps one for each Cursor or ChatGPT account. When you add an account, your browser asks for permission to use that service's cookies. AI Limits saves each account's sign-in cookies (its HttpOnly cookies, except bot protection) on this device, for the card they belong to: the account signed in now, and each other account when it is read while this browser is signed in to it. It sends them only to that service and deletes them when you disconnect that card. Don't use Log out on the service's site: it would end the saved sign-in of your other account too.

## Services

### ChatGPT

Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.

### Claude

Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.

### Kimi

With permission, AI Limits may read the page's localStorage.access_token and refresh_token on kimi.com. It does not read Kimi cookies. The Kimi tokens are held only in memory-backed session storage until the browser exits, and the refresh token is sent only to Kimi's sign-in service (auth.kimi.com) to renew access. It stores normalized usage locally.

Connect and manual Refresh may briefly open one inactive Kimi tab when recovery is needed. Scheduled or automatic refresh never opens a tab.

### Cursor

Reads base usage from your signed-in Cursor session and refreshes it about every 15 minutes. To request Grok Bot and extra-credit JSON, AI Limits may run bundled read-only code in one already-open cursor.com page, including during scheduled refresh. Only Connect or manual Refresh may briefly open one inactive spending tab when none is open. It does not inspect page content, browser storage, or cookie values directly; the browser attaches signed-in Cursor cookies to those fixed same-origin requests.

Connect and manual Refresh prefer an already-open Cursor tab. Scheduled refresh never opens one.

### Grok

Reads usage from an already-open grok.com page. On Connect or manual Refresh, AI Limits may run bundled read-only code there, or briefly open one inactive grok.com tab if none is open. It does not inspect page content, browser storage, or cookie values directly; the browser attaches signed-in Grok cookies to those same-origin requests. Scheduled refresh may inject into an already-open grok.com tab and never opens a new one.

### Gumloop

With permission, AI Limits may run bundled read-only code in a gumloop.com page to read Gumloop's sign-in tokens from that page's storage. It does not read Gumloop cookies. The tokens are held only in memory-backed session storage until the browser exits; the refresh token is sent only to Google's sign-in service that Gumloop uses (securetoken.googleapis.com) to renew access, and the access token only to api.gumloop.com. It refreshes about every 15 minutes and stores normalized usage locally.

Connect and manual Refresh prefer an already-open gumloop.com tab. If none is open, they may briefly open one inactive gumloop.com tab. Scheduled refresh may read an already-open gumloop.com tab and never opens one.

### Mistral

Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.

### Perplexity

Reads usage from your signed-in browser session, stores normalized usage locally, and refreshes about every 15 minutes.

### ElevenLabs

Uses an API key you provide, stores it locally in AI Limits, and refreshes about every 15 minutes.

When you create the key, select User → Read. Leave generation and write permissions off. ElevenLabs does not publish the exact endpoint-to-scope mapping, so validation confirms access.

### DeepSeek

Uses an API key you provide, stores it locally in AI Limits, and refreshes about every 15 minutes.

### Moonshot

Uses an API key you provide, stores it locally in AI Limits, and refreshes about every 15 minutes.

### DeepInfra

Uses an API key you provide, stores it locally in AI Limits, and refreshes about every 15 minutes.

### Fireworks

Uses an API key you provide, stores it locally in AI Limits, and refreshes about every 15 minutes.

### OpenAI

Uses an API key you provide, stores it locally in AI Limits, and refreshes about every 15 minutes.

### GroqCloud

Uses an API key you provide, stores it locally in AI Limits, and refreshes about every 15 minutes.

### OpenRouter

Uses an API key you provide, stores it locally in AI Limits, and refreshes about every 15 minutes. If you are signed in to openrouter.ai, it also reads promotional credits from your Credits page.

### Droid

Uses a Factory API key you create for Droid, stores it locally in AI Limits, and refreshes about every 15 minutes.

### GLM

Uses your GLM Coding Plan API key from Z.ai, stores it locally in AI Limits, sends it only to api.z.ai, and refreshes about every 15 minutes. Z.ai's terms ask that keys stay out of client-side code and limit the plan to supported tools, so connecting may put your Z.ai account at risk.

### Warp

Uses a Warp API key you create, stores it locally in AI Limits, sends it only to app.warp.dev, and refreshes about every 15 minutes. Warp keys cannot be limited to read-only access and can start agent runs billed to you, so create a dedicated key with an expiry.

### New API

Supports multiple independent connections. Each stores its own New API instance URL, relay key, label, usage, and History locally; same-origin connections share only the browser's host permission.

It shows the key's granted, used, and remaining quota. Unlimited keys show absolute usage without an invented percentage.

Paste the homepage, dashboard URL, or an API URL such as /v1/messages. AI Limits removes known console and API suffixes, then validates the instance through /api/status. HTTPS is required, except localhost for development.

AI Limits calls only the read-only /api/usage/token/ endpoint and stores the key locally. The request is read-only, but the relay key itself may still call models; apply key limits in New API if needed.

This mode does not read account wallet, subscriptions, admin data, or other relay keys. Each configured instance is read independently.

### LiteLLM

Supports multiple independent connections. Each stores its own LiteLLM base URL, virtual key, label, usage, and History locally; same-origin connections share only the browser's host permission.

### ClawRouter

Supports multiple independent connections. Each stores its own ClawRouter base URL, policy key, label, usage, and History locally; same-origin connections share only the browser's host permission.

### sub2api

Supports multiple independent connections. Each stores its own sub2api base URL, group key, label, usage, and History locally; same-origin connections share only the browser's host permission.

### LLM Proxy

Supports multiple independent connections. Each stores its own LLM Proxy base URL, API key, label, usage, and History locally; same-origin connections share only the browser's host permission.

## Self-hosted connections

Each LiteLLM, ClawRouter, sub2api, LLM Proxy connection keeps its own instance URL, API key, label, usage, and History. Same-origin connections share only the browser's host permission.

Paste the base URL of the instance. AI Limits validates and normalizes it before requesting only that instance's read-only usage endpoint. HTTPS is required, except localhost for development.

Each key is stored locally and sent only to its own instance, for that read-only usage request.

AI Limits does not inspect provider pages or send this key to any other origin. Each configured instance is read independently.

## History charts

### Usage history

Only successful, normalized quota observations are plotted. A solid line is a reading and the shaded area is quota used; a dashed stretch has no reading in between. Narrow windows draw one bar each, and the narrowest draw one bar per day. The newest 48 hours stay at collection resolution; older retained history is compacted hourly, keeping the last reading of each window, for up to 30 days on this device. Counter observations are stored but are not graphed; balance-first providers chart their balance separately.

Counters and balances are stored as point-in-time observations.

### Balance history

Only successful balance readings are plotted, in the provider's currency on a zero-based scale. A rise between readings of at least 1% and at least 0.50 in the provider's currency is marked as a top-up. After a currency change, only readings in the new currency are shown. The newest 48 hours stay at collection resolution; older retained history is compacted hourly for up to 30 days on this device. Balance readings store no credentials or account identifiers.
