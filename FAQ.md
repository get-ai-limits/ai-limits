# AI Limits FAQ

English | [简体中文](FAQ.zh-CN.md)

## Does History update after manual refresh, automatic refresh, or both?

Both. A successful Connect, provider Refresh, header refresh button, or scheduled automatic refresh adds one normalized typed History observation containing the quota, counter or spend, and balance metrics returned by that provider. History graphs quota metrics and the balance of balance-first providers; counter or spend observations and other balances remain stored but are not graphed.

Failed, deferred, skipped, superseded, or malformed refreshes do not add a
history observation. They also do not insert a zero or copy the last value
forward.

## Does automatic refresh require the side panel to stay open?

No. AI Limits uses a Chrome alarm and its Manifest V3 background service worker,
so closing the side panel does not stop scheduled refreshes. When you reopen the
panel, it reads the latest data from local extension storage.

## What must be true for automatic refresh to run?

- **Automatic refresh** must remain enabled in **Settings**.
- At least one provider must remain connected. AI Limits removes the alarm when
  no providers are connected.
- Chrome must still have that provider's optional permission.
- For ChatGPT, Claude, Kimi, Cursor, Grok, Mistral, Perplexity, and Gumloop, the signed-in
  browser session must still be usable. API-key providers instead need a saved
  active key; configurable instances also need their exact instance permission.
- Chrome must be running and able to run background extensions.

The alarm runs approximately every 15 minutes. Chrome scheduling, device sleep,
provider backoff, and network conditions can delay a refresh, so this is not an
exact sampling interval.

## What happens while Chrome is closed or the computer is asleep?

AI Limits cannot refresh while Chrome is fully closed or the device is asleep.
Chrome may deliver a delayed alarm after it resumes. AI Limits also checks and
recreates its refresh alarm when the extension worker or Chrome starts, but it
does not reconstruct observations for intervals that were missed.

## If manual refresh works, should automatic refresh also work?

Usually for browser-session providers other than Kimi and Grok, as long as their
permission and session remain valid, and for API-key providers while the saved
key and host permission remain active.
However, manual refresh bypasses scheduled backoff, while automatic refresh
respects it. Kimi manual refresh may additionally perform interactive session
recovery. Any Cursor refresh may request Grok Bot and extra-credit JSON
through an already-open Cursor page; only manual refresh may briefly open one
inactive spending tab when none is open. If no tab is open or the read does
not finish, scheduled refresh keeps last-good page values until Grok Bot's weekly
reset and explains when they could not be refreshed. Grok
Connect or manual Refresh read grok.com from a page because extension-background
requests are rejected; they prefer an already-open grok.com tab and may briefly
open one inactive tab if none is open. Scheduled Grok refresh may inject into
an already-open grok.com tab and never opens a new one.

Gumloop works the same way as Kimi: AI Limits keeps the Gumloop sign-in it
reads from a gumloop.com page in memory-backed session storage and renews it
without a tab until the browser restarts. After a restart or extension update,
open gumloop.com once or use a manual Refresh to start this again; until then
scheduled Gumloop refresh defers and keeps the last good data. Signing out of
Gumloop in a tab AI Limits does not read takes effect once Gumloop rejects the
held session or the browser exits; disconnect Gumloop to drop it immediately.

Kimi has an additional limitation described below.

## Why do Cursor Grok Bot or extra credits sometimes update only after manual refresh?

Cursor's base monthly and on-demand usage refreshes in the background. Its
Grok Bot and extra-credit dashboard endpoints reject cross-origin POSTs
(`Invalid origin for state-changing request`), so AI Limits reads them through
a `cursor.com` page. Scheduled refresh uses one only if it is already open.
Connect or an explicit manual Refresh prefer an already-open tab too; if none
is open, they may briefly create one inactive spending tab, wait up to 10
seconds, and close only the tab they created. The extension
runs a bundled exact-origin function that sends three fixed read-only dashboard
requests and returns their JSON for schema validation in the extension. It
does not inspect rendered content, browser storage, or cookie values directly;
Chrome attaches the signed-in Cursor cookies to those fixed same-origin
requests. It never activates a Cursor tab, and scheduled refresh never opens
one. Last-good Grok Bot and extra-credit values stay
on the card until Grok Bot's weekly reset; the card says why they could not be
refreshed. Other Cursor accounts read these through an open cursor.com tab
with their own saved sign-in; without an open tab they keep their last values.

## Why does Grok need a grok.com page?

Grok's session and usage endpoints reject extension-background requests when
the Origin is not `https://grok.com`. AI Limits therefore reads them only by
running bundled exact-origin code in a grok.com page. Connect or manual Refresh
prefer an already-open tab. If none is open, they may briefly create one
inactive `https://grok.com/` tab, wait up to 10 seconds, and close only the tab
they created. Scheduled refresh may inject into an already-open grok.com tab
and never opens a new one. The function does not inspect rendered content,
browser storage, or cookie values directly; Chrome attaches the signed-in Grok
cookies to those same-origin requests.

## Why doesn't Kimi automatic refresh always work, and why can manual refresh open a background tab?

Kimi automatic refresh is best-effort and may not always work; a manual Connect
or Refresh may briefly open an inactive Kimi tab in the background to recover
the session.

Kimi scheduled refresh never opens a tab. An interactive Connect or Refresh may
open at most one inactive temporary Kimi tab, waits up to 30 seconds for
recovery, and closes only the tab it created. Recovery waits until Kimi finishes
loading the page before accepting a session token, and it leaves the tab open
long enough for Kimi to replace an expired token. It reads an `access_token`
from an already-open Kimi page and does not read Kimi cookies.

Kimi access tokens expire after about 15 minutes, but each time AI Limits
reads a Kimi page it also keeps that page's refresh token in memory-backed
session storage. Scheduled refresh then renews the access token directly with
Kimi, with no tab, until the browser restarts. After a restart or extension update, open Kimi once
or use a manual Refresh to start this again. If no usable session is
available, automatic refresh defers until a later refresh, preserves the last
good data, and adds no history observation.

A manual **Connect** or **Refresh** is interactive and may use that inactive
homepage tab to let Kimi refresh its own session. This difference means manual
Kimi refresh can work when scheduled refresh cannot.

## Why does ElevenLabs need an API key, and can I reopen the setup page after signing in?

ElevenLabs uses a user-created API key; after a successful check, AI Limits
stores it locally and scheduled refresh does not open an ElevenLabs tab.

Clicking **Connect ElevenLabs** opens both the in-panel guide and ElevenLabs'
official API-keys page. If the page asks you to sign in, finish signing in and
use **Open API keys page** in the guide to reopen it. Create a key named
**AI Limits**, select **User → Read**, and avoid generation or write
permissions. ElevenLabs does not formally publish the exact mapping between
that scope control and the subscription endpoint, so **Validate & connect**
trims the candidate and checks the real read-only request; only a successful
validation is saved, and AI Limits never enables broader scopes for you.

Only your explicit setup or reopen action opens the normal ElevenLabs page.
After connection, manual and scheduled usage refreshes call the API in the
background and do not open or inspect an ElevenLabs tab.

## How is the ElevenLabs key stored, and what happens if it is rejected?

After validation, AI Limits keeps the key in a separate local credential record
whose Chrome storage access is restricted to trusted extension contexts. It is
not copied into usage state or History and is sent only to the ElevenLabs API
for the read-only subscription request. This is extension-origin isolation,
not OS-keychain encryption: someone with access to your unlocked Chrome profile,
extension DevTools, or profile files may be able to inspect it.

If ElevenLabs later rejects the saved key, AI Limits stops scheduled
ElevenLabs requests and shows **Replace key** while preserving the last good
normalized usage and History. A failed replacement leaves the prior key
unchanged. Disconnecting ElevenLabs, choosing **Delete all local data**,
uninstalling the extension, or clearing extension storage deletes the saved
key. External host-permission removal instead marks ElevenLabs as requiring
permission and retains its local configuration, saved key, normalized usage,
refresh status, and History until reconnect or explicit disconnect/delete.

## What does New API support, and what URL should I enter?

AI Limits supports multiple independent New API instances. Each connection has
its own normalized base URL, optional label, relay key, current usage, refresh
state, replacement/rejection status, and History. It reads only that key's
`/api/usage/token/` response: capped keys show granted, used, and remaining
quota, while unlimited keys show absolute usage without an invented
percentage. It does not read account wallet, subscriptions, or admin data.

Two New API instances on the same origin share only Chrome's browser-global
origin permission; they never share a relay key, label, usage state, or
History. Disconnecting one instance deletes only that instance's key,
configuration, usage, refresh status, and History before permission cleanup.
The shared grant remains while a sibling still owns it; disconnecting the final
owner removes it best-effort and keeps durable cleanup evidence for retry.
Externally removing the grant instead marks every affected instance as needing
permission while retaining its nonsecret configuration, saved key, normalized
usage, refresh status, and History until reconnect or explicit
disconnect/delete.

You can paste the site homepage, a dashboard URL, `/v1`, `/v1/messages`, or
`/api/usage/token/`. AI Limits removes those known suffixes, preserves any
deployment subpath, and validates the result through `/api/status`. HTTPS is
required except for localhost development.

The usage request is read-only, but a relay key is not necessarily a
usage-only credential: the same key may still be able to call models. Use a
dedicated key and apply quota, model, IP, or other restrictions in your New API
instance where appropriate. The validated URL and key are saved locally for
background refresh. See [Supported providers](SUPPORTED_PROVIDERS.md) for the
full boundary.

## How is OpenAI different from ChatGPT?

ChatGPT uses the signed-in browser session on chatgpt.com. OpenAI uses a
user-created API key against the Platform organization and developer billing
surface: organization costs and completion usage first, with a fallback to
legacy credit grants when organization scope is unavailable.

## Does automatic refresh open provider tabs?

No. Scheduled refresh is non-interactive and never creates provider tabs. Only
an interactive Kimi **Connect** or **Refresh** may create an inactive
Kimi tab for session recovery and wait up to 30 seconds for the page to finish
loading. An interactive Cursor **Connect** or **Refresh**
may briefly create one inactive spending tab when no `cursor.com` tab is already
open, waits up to 10 seconds, and closes only the tab it created. An interactive
Gumloop **Connect** or **Refresh** may create one inactive gumloop.com tab only
when no gumloop.com tab is open and no held Gumloop session is available, waits
up to 15 seconds, and closes only the tab it created. ElevenLabs
opens its normal API-keys page only when you explicitly start setup or choose
**Open API keys page**. Other API-key providers, including New API, do not open
provider tabs for setup or refresh.

## What does History store, and for how long?

History stores successful normalized quota, counter or spend, and balance
observations per instance. Currency-denominated spend counters and balances are
normalized usage data, not raw payment transaction history. History
graphs quota metrics and the balance of balance-first providers; counter/spend
observations and other balances remain stored but are not graphed. History never stores credentials, raw provider responses,
or reconstructed provider history. Failed, deferred, skipped, or malformed
refreshes do not add History observations; AI Limits separately stores only the
latest sanitized refresh status.

Observations are retained locally for up to 30 days, subject to a
1,024-observation safety cap for each instance. Within that cap, observations
from the newest 48 hours stay at collection resolution; older retained history
keeps the latest observation in each UTC hour. Disconnecting an instance or
deleting all local data removes its History. External permission removal
retains History but pauses refresh until permission is restored or the instance
is explicitly disconnected/deleted.

## Why does the graph say it needs another successful refresh?

A line needs at least two observations for the selected quota window. On upgrade,
AI Limits may preserve the current valid snapshot as the first observation at
its original fetch time. One more successful refresh that includes the selected
quota window gives the graph a second point.

## Why are there gaps or separate segments in a graph?

AI Limits does not draw a continuous line across a missing quota window, a gap
longer than 90 minutes, or a changed reset boundary. This avoids presenting a
provider reset or a failed refresh as consumption. A window that disappears
from the provider's current response is not selectable until it returns.

A balance chart breaks its line after 3 hours without a reading. A rise in the
balance draws as a step up, because a top-up lands between two readings.

## Does switching between Used and Left change stored History?

No. AI Limits stores one canonical used ratio. **Used** displays that ratio;
**Left** displays its complement. The preference changes presentation only, not
the stored observation.

## Can I track more than one account of the same provider?

Yes, for ChatGPT, Cursor, and every API-key provider. Open **Add provider** and
choose **Add account** next to a provider you already use. Each account gets
its own card, History, and name, which you can change in Settings.

- **API-key providers** (OpenAI, OpenRouter, DeepSeek, and the rest): each
  account has its own key, so all of them refresh.
- **ChatGPT and Cursor** read the account signed in on chatgpt.com or
  cursor.com, and a browser holds only one at a time. When you choose **Add
  account**, a short guide in the side panel walks you through it. AI Limits
  asks for the optional `cookies` permission, saves
  the current sign-in for its card, signs the browser out of that site on
  this device, and opens the sign-in page for the next account. Every other
  account's sign-in is saved too, the next time it is read while the browser
  is signed in to it. After that, every account keeps
  refreshing, whichever one the browser is signed in to.
  Don't use **Log out** on the ChatGPT or Cursor site to switch accounts,
  because that ends the saved sign-in too. A saved sign-in lasts as long as
  the provider allows (about 60 days for Cursor). After that, that card asks you to
  sign in again: choose **Reconnect** and sign in to that account. Saved
  sign-ins stay on this device, unencrypted like saved API keys, and are
  deleted when you disconnect that card. ChatGPT
  tracks each workspace separately. See [Privacy](PRIVACY.md) for how saved
  sign-ins are kept and used.

Claude, Kimi, Grok, Mistral, Perplexity, and Gumloop still connect one account.

## What should I do before switching provider accounts?

For ChatGPT and Cursor you don't need to do anything: each connection keeps to
the login it was first read from, and a different signed-in account never lands
in its History. For other browser-session providers, disconnect that provider
instance in AI Limits before changing accounts. Their History is scoped to the
provider instance and stable metric identifier, not a provider account
identifier, so disconnecting clears that instance's history and prevents
same-plan accounts from being combined.

For data handling details, see [Privacy](PRIVACY.md). To report a problem, use
[GitHub Issues](https://github.com/get-ai-limits/ai-limits/issues) without including
cookies, credentials, private usage data, or other secrets.
