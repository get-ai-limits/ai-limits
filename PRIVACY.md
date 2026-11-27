# Privacy Policy

Last updated: November 26, 2026

AI Limits is a locally running browser extension for Chrome, Edge, and Firefox
by TiantianFlow. This policy
describes version 0.7.0.

AI Limits is an independent project. It is not affiliated with, endorsed by,
or authorized by any supported provider, its parent company, or its affiliates.

## Data AI Limits accesses

AI Limits accesses data only after you connect a provider and approve its
optional Chrome permissions. Depending on what that provider returns, the
extension reads and normalizes:

- provider and access status;
- after you add a second Cursor or ChatGPT account, that site's sign-in
  cookie, which is saved for its connection, and the site's bot-protection
  cookies, which are sent with it and not saved (see "Saved sign-ins" below);
- plan, subscription, or organization labels;
- quota labels, usage or remaining ratios and amounts, limit units, window
  start times, reset times, durations, and segments;
- cumulative counters or spend with their value, semantic, unit, optional
  limit, and cycle;
- remaining balances with their value, unit, optional original limit, and
  cycle;
- per-instance History made from successful normalized observations of those
  quota, counter/spend, and balance fields;
- refresh timestamps and sanitized success, retry, sign-in, challenge,
  temporary-error, response-change, or other-account status; and
- for ChatGPT and Cursor connections, an opaque login key: a SHA-256 hash of
  the provider's stable user ID (for ChatGPT, together with the workspace ID),
  used only to keep each connection on its own
  account when you connect more than one.

The extension also handles provider session, usage, subscription, and
organization-response JSON in memory. A ChatGPT account identifier derived
from its access credential and the selected Claude organization UUID and
capabilities are request-local and are not persisted, as are the OpenRouter
signed-in user ID and key creator ID compared for promotional credits, and the
Gumloop organization ID used to build its credit paths. The Gumloop user ID is
held with its session in memory-backed session storage, as described below, and
is not written to persistent storage. The raw Gumloop project, credit, and
subscription replies are request-local and are not persisted. A Claude organization
name may be normalized and stored as the visible plan label. The extension
discards email-shaped account labels and does not query the Claude email
endpoint. To tell several accounts apart, the ChatGPT user ID (`sub` from the
access credential, or the session reply's user ID) with the workspace ID and the Cursor user ID (`sub`) from `cursor.com/api/auth/me`
are hashed into the login key described above; the raw IDs are not persisted.
That Cursor reply also contains the account's email, name, and picture, which
are discarded in memory and never stored or shown. For ElevenLabs, the extension retains only normalized
monthly credit and voice-capacity fields from the subscription response; it
does not retain invoices, payment attempts, coupons, payment identifiers, or
currency overage fields. It does not read prompts, conversations, generated
responses, or rendered provider page content, apart from the promotional
credit pools in OpenRouter's Credits page payload described below.

For each New API instance, the extension retains an opaque instance ID, the
normalized base URL, optional user label, relay-key name, instance display
name, independent access/refresh state, and key-specific granted, used, and
remaining quota. Unlimited keys retain an absolute consumed counter without an
invented limit or ratio. It does not retain model-limit maps or key expiry as a
quota reset and does not read account wallet, subscriptions, usage logs, admin
data, or other relay keys.

## Provider authentication and requests

ChatGPT, Claude, Kimi, Cursor, Grok, Mistral, Perplexity, and Gumloop use
signed-in browser sessions. AI Limits sends read-only requests to those
providers' own web-session services, plus the Kimi and Gumloop token-renewal
calls described below, and browser cookies may accompany requests to the same
provider origin (Kimi and Gumloop usage requests carry only the access token,
without cookies). OpenRouter is an API-key provider, but its
promotional-credit read also uses the signed-in openrouter.ai session, as
described below. Requests normally run directly from the extension; the Cursor,
Grok, and Gumloop page-origin reads described below run in an already-open exact-origin
page or, if none is open during Connect or manual Refresh, in one inactive tab
created for that attempt. ChatGPT
and Kimi access credentials, the derived ChatGPT account identifier, and the
selected Claude organization UUID and capabilities may be held in memory long
enough to complete the related collection attempt and request sequence. Those
values are not written to persistent extension storage or included in saved
refresh results. The Kimi session held in memory-backed session storage is
described below. The selected Claude organization name may separately be
stored as the visible plan label.

For Kimi, AI Limits reads the exact `access_token` entry from an already-open
matching Kimi page, and, when no page is open, uses the Kimi session it holds
(described below). When it reads that page, it also reads the exact
`refresh_token` entry. It does not read Kimi cookies or other Kimi
browser-storage entries, and its Kimi usage requests carry only the access
token, without cookies. During an interactive Connect or
Refresh, either a missing credential or a credential rejected by Kimi may
cause AI Limits to create one inactive Kimi homepage tab. Recovery reads
`access_token` and `refresh_token` only after that page sets
`window.__kimiAppMounted`, the flag Kimi sets when its client app mounts. It
then keeps the owned tab open so Kimi can replace an expired token. Recovery
has a 30-second deadline for obtaining a credential. When recovery finishes or
times out, the extension attempts best-effort cleanup of only the tab and
lease it owns; browser shutdown or API errors can delay or prevent cleanup.
Scheduled refresh never creates a Kimi tab.

While interactive Kimi recovery is active, its cleanup lease stores only a
generated lease identifier with the temporary tab ID and creation timestamp in
`chrome.storage.session`. This transient metadata supports cleanup if the
background worker is interrupted. AI Limits attempts to remove it when
recovery finishes and also performs best-effort abandoned-lease cleanup when
the background worker starts.

Kimi access tokens last about 15 minutes, and the Kimi page renews them only
while a Kimi tab is open. So scheduled refresh can keep working after the tab
closes, AI Limits holds a Kimi session in `chrome.storage.session`: the
current Kimi refresh token, the most recent access token with its expiry time,
and the page refresh token the session was taken from (kept only to tell when
the page holds a different session). That storage is memory-backed: the browser
clears it when it exits or when the extension is reloaded or updated, and it
is never written to disk or included in saved refresh results. When the
access token is missing, expired, or rejected by Kimi, the background worker
sends the current refresh token, and nothing else, to Kimi's own sign-in
service at
`https://auth.kimi.com/api/account.gateway.v1.AuthService/RefreshToken`,
without cookies. It keeps the new pair Kimi returns and never opens a tab to
do so. The held session is dropped when Kimi rejects the refresh token, when a
Kimi page shows the user is signed out, when Kimi access is disconnected or
its permission is removed, and when all local data is deleted. Signing out of
Kimi in a tab that AI Limits does not read afterwards drops the held session
only once Kimi rejects the refresh token or the browser exits; disconnect Kimi
in AI Limits to drop it immediately. After a browser
restart, Kimi needs one open Kimi tab or one manual Connect or Refresh before
scheduled refresh can renew on its own again.

For Gumloop, which signs users in with Google's Firebase Authentication, AI
Limits uses the optional `scripting` permission to run a bundled read-only
function in an already-open `https://www.gumloop.com/*` page. That function
reads only the Firebase sign-in entry in the page's `firebaseLocalStorageDb`
IndexedDB database: the Firebase ID token with its expiry time, the Firebase
refresh token, the Firebase web API key Gumloop's page uses, and the Gumloop
user ID. It does not read Gumloop cookies, other browser-storage entries, or
page content. The background worker then sends three read-only GET requests to
`https://api.gumloop.com` without cookies, carrying the ID token as a bearer
token and the user ID in the `x-auth-key` header, the same way Gumloop's own
Credit Usage page does: `/project` (only to learn the organization ID),
`/organization/{id}/credits` (remaining credits), and
`/organization/{id}/subscription` (monthly allotment, billing period, and
plan tier). The organization ID is used only to build those two paths and is
not stored. If those background requests fail before Gumloop answers, or
Gumloop refuses them, and a gumloop.com page is open, the same three reads run
from inside that page with the same token, and only the status codes and JSON
bodies come back. During an interactive Connect or Refresh only, when no
gumloop.com page is open and no held session is available, AI Limits may
create one inactive `https://www.gumloop.com/settings/profile/general` tab,
read the sign-in entry within a 15-second deadline, and then attempt
best-effort cleanup of only the tab and lease it owns. Scheduled refresh never
creates a Gumloop tab. Its cleanup lease works like the Kimi lease described
above.

Gumloop ID tokens last about an hour. So scheduled refresh can keep working
without a Gumloop tab, AI Limits holds the Gumloop refresh token, the Firebase
web API key, the user ID, and the most recent ID token with its expiry time in
memory-backed `chrome.storage.session`, under the same rules as the Kimi
session: it is cleared when the browser exits or the extension is reloaded or
updated, and it is never written to disk or included in saved refresh results.
When the ID token is missing, about to expire, or rejected by Gumloop, the
background worker sends the refresh token, and nothing else besides the
public web API key in the URL, to Google's Firebase token service at
`https://securetoken.googleapis.com/v1/token`, the same service the gumloop.com
page itself calls, without cookies, and keeps the new token it returns. The
held session is dropped when that service rejects the refresh token, when a
gumloop.com page shows the user is signed out, when Gumloop access is
disconnected or its permission is removed, and when all local data is
deleted. Signing out of Gumloop in a tab that AI Limits does not read
afterwards drops the held session only once the token service rejects the
refresh token or the browser exits; disconnect Gumloop in AI Limits to drop it
immediately. After a browser restart, Gumloop needs one open gumloop.com tab or
one manual Connect or Refresh before scheduled refresh can renew on its own
again. When the reads fall back to an open gumloop.com page, the ID token is
passed into that page only for those three requests.

For Grok, grok.com rejects extension-background session and usage requests
when the Origin is not `https://grok.com`. AI Limits therefore does not fetch
grok.com from the extension worker. It checks for one already-open tab matching
`https://grok.com/*` and uses the optional `scripting` permission to run a
bundled function in that page's main JavaScript world. During Connect or an
explicit manual Refresh only, if none exists, the same path may create one
inactive `https://grok.com/` tab. That create-wait-read path has a 10-second
deadline. When it finishes or times out, the extension attempts best-effort
cleanup of only the tab and lease it owns; browser shutdown or API errors can
delay or prevent cleanup. The function verifies the exact `https://grok.com`
origin, sends the signed-in session, usage-pool, subscription, and chat-mode
rate-limit requests, and returns only those responses for schema validation in
the extension context. It does not read rendered page content, local or session
storage, or cookie values directly. Chrome does attach the signed-in Grok
cookies to these fixed same-origin requests. AI Limits never activates a Grok
tab. Scheduled refresh may inject into an already-open grok.com tab and never
opens a new one. Raw page-probe bodies are request-local and are not persisted.

While that owned Grok tab is active, the extension stores only a generated lease
identifier with the temporary tab ID and creation timestamp in
`chrome.storage.session`. This transient metadata supports cleanup if the
background worker is interrupted. AI Limits attempts to remove it when the
owned tab is released and also performs best-effort abandoned-lease cleanup
when the background worker starts.

For Cursor, the base monthly and on-demand request runs from the extension.
During collection, AI Limits checks for one already-open tab matching
`https://cursor.com/*`. If one exists, it uses the optional `scripting`
permission to run a bundled function in that page's main JavaScript world. If
none exists, only Connect or an explicit manual Refresh may create one
inactive `https://cursor.com/dashboard/spending` tab. That create-wait-read
path has a 10-second deadline. When it finishes or times out, the extension
attempts best-effort cleanup of only the tab and lease it owns; browser
shutdown or API errors can delay or prevent cleanup. The function verifies the
exact `https://cursor.com` origin, sends POST requests with the fixed `{}`
body only to the Grok Bot, credit-grant, and aggregated-usage dashboard
endpoints, and returns only their JSON responses for schema validation in the
extension context. It
does not read rendered page content, local or session storage, or cookie
values directly (saved sign-ins, described below, are separate from this
page function). Chrome does attach the signed-in Cursor cookies to these
fixed same-origin requests. AI Limits never activates a Cursor tab. Scheduled
refresh may run the same function in an already-open `cursor.com` tab and never
opens a new one. If no tab is open or the read does not finish, page-only Grok Bot and extra-credit
metrics are refreshed only by Connect or manual Refresh; last-good normalized
values may remain visible until Grok Bot's weekly reset. Raw dashboard JSON is request-local and is not persisted.

While that owned Cursor tab is active, the extension stores only a generated
lease identifier with the temporary tab ID and creation timestamp in
`chrome.storage.session`. This transient metadata supports cleanup if the
background worker is interrupted. AI Limits attempts to remove it when the
owned tab is released and also performs best-effort abandoned-lease cleanup
when the background worker starts.

For conservative Chrome Web Store disclosure, AI Limits classifies its
current-tab exact-provider-origin checks as **Web history** access. For Kimi,
Cursor, Grok, and Gumloop, the extension learns only whether a tab at that fixed
provider origin is currently open so it can complete the user-requested
provider operation.
This open-state result is used locally for that attempt and is never retained,
transmitted, or assembled into a list of visited pages.

ElevenLabs uses a user-created API key and its documented public subscription
API instead of a browser-session credential. The guided connection opens the
official API-keys page as a normal page; the extension does not inspect it. The
guide recommends **User → Read** without generation or write permissions, but
ElevenLabs does not formally document the exact endpoint-to-scope mapping. AI
Limits therefore validates the real read-only subscription request and never
enables broader scopes for the user.

AI Limits sends the saved key only to https://api.elevenlabs.io as the
xi-api-key header for the read-only subscription request. It is not sent to
the developer or any other provider. Only the user's explicit setup or reopen
action opens the ElevenLabs API-keys page; manual and scheduled refresh do not
open or inspect provider tabs.

Each New API instance uses a user-provided URL and relay key rather than a
browser session. AI Limits removes recognized console and API suffixes,
validates the normalized base URL with its public `/api/status` response, then
sends that instance's key as an Authorization Bearer header only to the same
base URL's read-only `/api/usage/token/` endpoint. The request AI Limits makes
is read-only, but the relay key itself may still authorize model calls; AI
Limits cannot reduce the key's server-side authority. Multiple instances,
including same-origin instances with different keys and labels, remain
independent. AI Limits does not use management PAT or admin APIs.

LiteLLM, ClawRouter, sub2api, and LLM Proxy also use a user-provided instance
URL and API key. AI Limits sends the key only to the same normalized instance
origin for the read-only `/key/info`, `/v1/usage`,
`/v1/usage?days=30&timezone=UTC`, or `/v1/quota-stats` request associated with
the selected provider. Each configured instance keeps independent
credentials, nonsecret configuration, normalized usage, and History.

DeepSeek, Moonshot, DeepInfra, Fireworks, OpenAI, GroqCloud, OpenRouter,
Droid, GLM, and Warp use user-created API keys at fixed provider API origins. OpenAI here is
the Platform organization and developer billing API, not the ChatGPT consumer
session. Droid is Factory's coding product, not an organization-admin credits
API. AI Limits sends those keys
only to
`api.deepseek.com/user/balance`, `api.moonshot.ai/v1/users/me/balance`,
DeepInfra's `api.deepinfra.com/payment/checklist` and `/payment/usage`
endpoints, Fireworks' `api.fireworks.ai/v1/accounts` and selected-account
`/billing/summary` endpoint, OpenAI's organization cost and completion-usage
endpoints or legacy credit-grants fallback, GroqCloud's Prometheus query
endpoint, OpenRouter's `/api/v1/credits` and `/api/v1/key` endpoints,
Droid's `api.factory.ai/api/billing/limits` request, GLM's
`api.z.ai/api/monitor/usage/quota/limit` request, or Warp's
`app.warp.dev/graphql/v2?op=GetRequestLimitInfo` request. When that Droid response
is not a token-rate-limits payload, AI Limits instead reads
`api.factory.ai/api/organization/subscription/usage`. It may also read
`api.factory.ai/api/app/auth/me` for a plan label and does not store the
account identifier from that response. The Droid key is sent as an
Authorization bearer token with `x-factory-client: web-app`. The GLM key is a
Z.ai GLM Coding Plan key and is sent only as an Authorization bearer token to
`api.z.ai/api/monitor/usage/quota/limit`, the read-only request Z.ai's own
usage plugin makes; it is not a documented public API. Z.ai's terms ask that
keys not be exposed in browser or other client-side code and limit the Coding
Plan to officially supported tools. Connecting GLM means accepting that the key
is held in AI Limits' local credential vault and that Z.ai may treat this use
as outside those terms, which could affect the user's Z.ai account. The Warp
key is sent only as an Authorization bearer token in that one read-only
GraphQL query, which Warp's own open-source client sends; it is not a documented
public API. Warp's server refuses requests that carry an extension `Origin`
header, so a session rule removes that header from this one request and no
other. The query asks only whether the plan is unlimited, for credit
counts, refresh timing, add-on credit amounts, types, and expirations, and for
any error message. Warp API keys cannot be limited to read-only
access, so AI Limits suggests creating a dedicated key with an expiry.
OpenRouter's public API does not report promotional credit grants. When the
key is a personal key and the user is signed in to openrouter.ai in the same
browser, AI Limits also reads the signed-in `openrouter.ai/settings/credits`
page payload once per refresh, with no API key attached; Chrome attaches the
user's existing openrouter.ai cookies, which AI Limits does not read. It shows
the grants only when the page's signed-in account matches the key's creator
account, keeps only the combined remaining and granted amounts of active
grants, and drops the account identifier and grant names after the comparison.
openrouter.ai sign-in tokens are short-lived and renewed while a site tab is
open, so when the page cannot be read, the last matching reading stays visible
for up to 24 hours; after that, or when another account is signed in, the
promotional-credit metric is hidden.
These
read-only responses are normalized into balance, quota, counter, or spend
metrics; raw provider responses are not persisted.

### Saved sign-ins for several Cursor or ChatGPT accounts

A browser holds one Cursor sign-in and one ChatGPT sign-in at a time. When you
add a second Cursor or ChatGPT account, AI Limits asks for the optional
`cookies` permission. It is asked for only then, not for a first connection,
and it is used only for `cursor.com` and `chatgpt.com`.

With it, AI Limits copies the sign-in cookies the browser holds for that
site and saves them for the connection whose account they belong to. These
are the named sign-in cookies (Cursor's `WorkosCursorSessionToken`;
ChatGPT's `__Secure-next-auth.session-token`, including any numbered chunks,
and its `_account` workspace cookie). They also include the site's other HttpOnly
cookies, other than the bot-protection cookies listed below, because a site
can keep a second sign-in cookie that restores the first. It saves at most 64
cookies, sign-in cookies first; a cookie it cannot save (too long, or with
characters a cookie header cannot carry) stays in the browser. That
connection is identified by the opaque login key described above. AI Limits
then removes those cookies from the browser, so the browser is signed out of that site on
this device. It does not use the site's own Log out, which would end the
session on the provider's servers. It then opens the provider's sign-in page,
so you can sign in to the other account. For 15 minutes after opening that
page, it watches for that site's sign-in cookie to change, and then reads the
waiting connection. A connection's saved copy, once it has one, is refreshed
from the browser whenever the browser is signed in to that connection's
account. A connection that never had a sign-in saved this way never gets one.
Choosing **Reconnect** on a card whose account is not signed in does the same
saving and local sign-out for the account that is signed in, but only after
the `cookies` permission was granted through **Add account**.

When the browser is signed in to a different account, AI Limits reads a
connection with its saved sign-in instead. For each such request from its
background service worker, it adds a session rule that matches only that
site's requests started by AI Limits itself outside any tab. The rule sets
the request's Cookie header to the saved sign-in plus the browser's
bot-protection cookies for that site (Cloudflare's `__cf_bm`, `cf_clearance`,
`_cfuvid`, and `__cflb`, and ChatGPT's `oai-did` device ID). It also drops any
cookie the site sends back. The request is sent without the browser's own
cookies, and the rule is removed as soon as the request finishes. AI Limits
sends these requests one at a time per site, so one account's request never
carries another account's sign-in. Your open tabs and the browser's own
sign-in are not affected. For Cursor, page-only Grok Bot and extra-credit
values are read only for the account the browser is signed in to. Other
Cursor connections keep their last values for those.

Saved sign-ins are stored in `chrome.storage.local` under a separate record
from usage state. In Chromium builds they have the same trusted-context
restriction as API keys (described below); Firefox has no such setting. Like
saved API keys, they are not OS-keychain encrypted and may be inspectable by
someone with access to the unlocked browser profile, extension DevTools, or
profile files. A saved sign-in gives access to that provider account, as the
site's own sign-in cookie does. They are sent only to the site they came
from, as the Cookie header described above. They are never included in usage
state, History, logs, analytics, or a developer backend. A saved sign-in is
deleted in these cases:

- when its connection is disconnected;
- the next time its connection is read after its session cookie expires;
- on **Delete all local data**;
- when you remove the `cookies` permission.

When no Cursor or ChatGPT connection remains, AI Limits also gives the
`cookies` permission back. Sessions end on the provider's own schedule. In
November 2026, Cursor's web sessions lasted 60 days from sign-in. After that,
the connection asks you to sign in again. Using the site's Log out while
signed in to an account also ends that account's saved sign-in. A sign-in
the site stops accepting is kept until one of the cases above, so a brief
failure never loses an account; the connection shows that it is signed out.

## Local storage and retention

AI Limits stores one application-state record in `chrome.storage.local`. It
contains display, language, and automatic-refresh preferences, per-instance nonsecret
configuration such as a normalized configurable-provider base URL and label, provider
order and Overview visibility, provider permission state, the normalized usage fields listed above, History, and
sanitized refresh-attempt metadata. It does not contain provider cookies,
browser-session credentials, or API keys. Saved Cursor or ChatGPT sign-ins,
when you add a second account, are kept in their own record, as described
above.

API keys are stored separately in chrome.storage.local,
which AI Limits restricts to trusted extension contexts through Chrome's
storage access level. Each configured instance has one separately keyed credential
record; same-origin instances never share it. Ordinary websites, other
extensions, and this extension's content scripts cannot read that record
through Chrome extension APIs. The saved key is not OS-keychain encrypted and
may be inspectable by someone with access to the unlocked Chrome profile,
extension DevTools, or profile files. The saved key is never included in usage
state, History, screenshots, reports, logs, analytics, or a developer backend.

In the Microsoft Edge build the same Chromium access level applies. Firefox does
not offer that access-level setting, so in the Firefox build the record is kept
in Firefox's extension storage without it. AI Limits declares no content
scripts; the only page-context code it runs is its own short readers on the
provider pages you connect, and that code has no access to extension storage.

Disconnect, Delete all local data, uninstall, or clearing extension storage
deletes the saved API key. If Chrome cannot revoke a final-owner host
permission, local instance deletion remains authoritative and durable cleanup
evidence is retained for retry.

Successful normalized quota, counter or spend, and balance observations are
stored per instance for up to 30 days, subject to a 1,024-observation
per-instance safety cap. Within that cap, the newest 48 hours remain at
collection resolution and older retained observations are compacted to the
latest observation in each UTC hour. History graphs plot
quota metrics and the balance of balance-first providers; counter or spend
observations and other balances remain stored but are not graphed. Currency-denominated spend counters and balances are
normalized usage data, not raw payment transaction history. History never
stores credentials or raw provider responses. Failed, deferred, skipped, or
malformed refresh results do not add observations.
When existing extension state is upgraded for this feature, one valid normalized
current snapshot can become the first observation at its original `fetchedAt`
time. The extension does not query a provider to reconstruct or backfill any
earlier history.

The local records remain in the current Chrome profile until you disconnect an
instance, choose **Delete all local data**, uninstall the extension, or clear
the extension's browser storage. Those actions delete affected saved API keys.
External permission removal does not delete instance data or saved API keys;
it prevents their use until access is restored or the instance is explicitly
disconnected/deleted. A successful **Replace key** overwrites only that
instance's prior key after the new key validates; a failed replacement leaves
the prior key unchanged.

- **Disconnect** invalidates active work and unconditionally deletes that
  instance's saved credential, nonsecret configuration, snapshot, History, and
  refresh-attempt metadata before separately attempting permission cleanup.
  Disconnect deletes that instance's credential, configuration, usage, refresh
  status, and History before permission cleanup; a shared origin remains
  granted while another active instance owns it, and final-owner removal is
  best-effort with durable retry evidence. If Chrome cannot revoke the final
  permission, local deletion remains authoritative and the extension reports
  and retries that cleanup problem.
- **Delete all local data** stops refresh work, clears the refresh alarm,
  attempts to revoke every provider permission, removes saved usage, and writes
  a clean default settings record with no History. It also deletes the
  credential record. If any permission cannot be revoked, local usage,
  credentials, and History are still removed, affected providers remain
  locally suppressed, and automatic refresh remains off.
- Externally removing a permission marks every affected instance
  permission-required while retaining its nonsecret configuration, normalized
  usage, refresh status, and History. Saved API keys also remain stored but are
  not used without permission. Active work is invalidated immediately. If the
  background worker is asleep, startup reconciliation applies the same access
  state. Reconnect can restore access; explicit Disconnect/Delete all performs
  the deletion lifecycle above.

## Automatic refresh

Automatic refresh is enabled in the default settings. A repeating Chrome alarm
is created only when automatic refresh is enabled and at least one provider is
connected. About every 15 minutes, AI Limits checks providers whose optional
permission is still granted. Cursor automatic refresh collects base monthly and
on-demand usage, and may read the page-only metrics from an already-open
`cursor.com` tab; it never opens a Cursor tab. API-key providers
additionally require an active saved key; configurable-origin providers also
require a normalized instance URL and exact runtime host permission. A rejected
API key stops that provider's scheduled requests while stale normalized usage
and history remain until replacement or deletion.
You can turn automatic refresh off in Settings at any time.

## Data transfer, sale, and sharing

AI Limits has no developer-operated backend, advertising SDK, analytics, crash
reporting, or telemetry. The extension does not sell personal data and does not
share it with the developer, advertisers, data brokers, or unrelated third
parties. Provider requests go only to the provider service you selected, or,
for Gumloop token renewal, to Google's Firebase token service that Gumloop's
own sign-in uses. Each processes those requests under its own terms and
privacy policy.

History remains in the local Chrome profile and is never transmitted to
the developer.

The extension does not log session credentials or saved usage data. Opening a
support link or filing an issue is a separate action you take outside the
extension.

## Limited use

AI Limits complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

AI Limits uses accessed data only to display and refresh provider usage, report
bounded refresh health, and carry out the user's permission, retention, and
display choices. It does not use or transfer that data for advertising,
profiling outside the extension's single purpose, creditworthiness, lending, or
other unrelated purposes. Because AI Limits has no developer-operated backend,
the developer and other humans cannot read locally stored extension data. A
user may separately choose to disclose information in a support issue.

## Security and limitations

Optional access lets the extension interact with sensitive signed-in provider
sessions and with API keys you provide. AI Limits minimizes that access and
stores normalized results locally, but no browser extension or local profile
is risk-free. Anyone who can access your unlocked Chrome profile may be able to
access extension data, including separately saved API keys and, while the
browser is running, the Kimi and Gumloop sessions held in
`chrome.storage.session`.

Browser-session provider endpoints are private, unsupported interfaces and may
change or stop working without notice. API-key providers use documented or
reverse-engineered HTTP endpoints, but their response and authorization
behavior can also change. Provider security controls, account rules, and
policies still apply. See
[SECURITY.md](SECURITY.md) for reporting guidance.

## Contact

Use [GitHub Issues](https://github.com/get-ai-limits/ai-limits/issues) for public
privacy questions or requests. Never include cookies, access credentials,
private usage details, or other secrets in an issue.
