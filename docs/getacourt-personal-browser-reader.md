# Personal Playtomic browser reader

This implementation adds a browser-local companion and a GetACourt page at
`personal-sources.html`. The approved club preference persists in extension
local storage. Every read is explicitly requested in local GetACourt; there
is no background synchronization, provider HTTP client, credential transfer,
booking action or payment route. It is not a provider OAuth/API connection.

## Run locally, without deploying

1. Serve only the `getacourt` directory on `http://localhost:8765` (bind to
   loopback, not a public interface). Open `/personal-sources.html` in Chrome
   or Edge. The profile in the normal GetACourt UI links to this page.
2. After reviewing and explicitly approving the new browser access, load the
   unpacked `getacourt/browser-companion` extension. It requests `activeTab`,
   `scripting` and `storage`; no permanent host, cookies, debugger, webRequest,
   alarms or identity permission. This installation has NOT been performed
   by the source change. The in-app browser does not host this extension.
3. Sign into Playtomic yourself in the same Chrome/Edge profile. Open one
   `/clubs/<slug>` page, expand a court, time and explicit duration/price
   offer, then open the companion popup and click **Allow this club**.
   Approval is an informed grant of this club's rendered offers to local
   GetACourt. Copy the public extension ID **and the pairing code displayed
   after Allow this club** into the local GetACourt page. The pairing code is
   a browser-only capability, not a Playtomic password or OAuth token. Never
   paste it into chat, code, screenshots or analytics. GetACourt stores neither
   the extension ID nor the pairing code.
4. Press **Read expanded offers**. Only the previously approved tab and club
   may be read. At least 60 seconds separates attempts, including failures
   after tab validation. This is our conservative limit, not a provider rate
   entitlement. The companion does not navigate, refresh or click the provider.
5. **Disconnect and clear** revokes the stored club approval and pairing code,
   clears the tab grant and prevents late in-flight completion. The popup also offers
   Disconnect. Removing the extension removes this capability. This does not
   log the user out of Playtomic or revoke any provider OAuth grant.

The local association survives browser restarts; temporary activeTab access
does not. Reconnect from the club's popup after restart, navigation, changed
club or lost access. No promise of permanent login or unattended server access
is made. The extension cannot reuse an in-app browser session in Chrome.

## Data and trust

The collector reads the visible Available courts section, venue heading,
selected date/sport and expanded Book rows only. The English mobile accordion
layout observed during investigation is supported. A different locale/layout,
collapsed offers, ambiguous date/sport, malformed row or more than 20 offers
fails closed. It never opens a booking or expands anything itself. Hidden
desktop alternatives, profile information, hydration state, cookies, browser
storage and provider network traffic are not read. Account query identifiers
are stripped from the source URL.

The response identifies `user_ui_observation`, `expanded_offers_only`, capture
time, displayed date and local time labels, court, duration and EUR price.
Timezone and provider source freshness remain unknown: reading an unchanged
DOM is not a provider refresh. No UTC conversion or full-inventory claim.
Results live only in GetACourt page memory and clear after 60 seconds, page
exit or disconnect. They do not enter the main availability, booking, Core,
database, telemetry or server APIs. Persistent storage contains only the
approved club URL. Extension ID entry is not saved by GetACourt.

Only a top-frame sender at `http://localhost:8765/personal-sources.html` may
request a read or revoke, **and only after presenting the random pairing code
issued by the companion popup**. The localhost pathname check alone is not
proof of page identity: other processes could serve that address. Web pages
cannot grant consent or ask the extension to reveal its pairing code. The
user deliberately copies the popup code into the local page; therefore only
enter it into the trusted local GetACourt page, not other localhost services. Request fields are allowlisted. All result strings render as text.
External action names, provider URLs, scripts, credentials or booking methods
cannot be supplied. The 60-second budget, single-flight guard and revocation
epoch reject bursts, simultaneous reads and late withdrawn responses. A new
Allow this club generates a new pairing code and invalidates the old one;
logout/disconnect clears pairing. The local page keeps the pairing code in
its input only, removes it when closing or disconnecting, and does not send
it to the provider.

This is personal assistance under the user's explicit opt-in. Provider API
delegation, automated product redistribution and commercial supply rights
remain separate. No legal or provider approval is inferred from this code.

## Troubleshooting (companion and reader page v0.1.1)

Updating files does not update an already loaded Chrome service worker or an
already open page. Reload the existing extension in Chrome, hard refresh the
local page, then approve the club again and privately enter the new pairing
code. Both popup and local page show v0.1.1. No reinstall or extra permission
is required. Never post pairing codes or an unmasked popup screenshot.

Unavailable responses contain fixed reason codes and fixed instructions:
`PAIRING_REQUIRED`, `CONNECT_REQUIRED`, `RATE_LIMITED`, `READ_BUSY`,
`TAB_CHANGED`, `TAB_ACCESS_REQUIRED`, `CONSENT_WITHDRAWN`,
`OFFER_SECTION_MISSING`, `NO_EXPANDED_OFFERS`, or a format/validation failure.
Raw browser/provider exceptions are never returned. The collector serializes
only allowlisted failure codes across script injection instead of relying on
browser exception serialization. Missing capture results are reported as
`READ_FAILED`, separately from a changed source URL. Unrecognized
errors stay `READ_FAILED`; none are availability observations.

`NO_EXPANDED_OFFERS` requires a visible explicit offer in the supported English
mobile court/time accordion, including court, time, duration, price and Book.
The reader does not parse the desktop colored schedule grid. Never click Book
to diagnose this reader. Share only the reason code/status text. Wait at least
60 seconds between deliberate attempts; no automatic retry or polling runs.
The generic error in the user's 24 October screenshot does not establish
whether pairing, tab access, the cooldown or the offer layout caused failure.
Live read/expiry/revoke acceptance remains pending until verified separately.

## Verification and remaining acceptance

`node --test getacourt/tests/personal-playtomic-reader.test.mjs` exercises consent,
exact sender/port/path/frame, forbidden requests, cooldown, lost tab context,
revoke cleanup, in-flight withdrawal and conservative visible-row parsing.
It is registered in fast, integration and full Platform CI. Fixtures are
fictional; there is no real account or observed live offer in the repository.

Installation and real Chrome/Edge activeTab-to-local-Get readback must still
be performed with user approval. VM tests do not establish browser permission
acceptance or a live connection. No deployment is needed for local acceptance.

## Portugal P0 update, 24 October 2026

The earlier exploratory notes below have been superseded by the current,
browser-verified receipt:
[`getacourt-portugal-p0-provider-ui-receipt-2026-10-24.md`](getacourt-portugal-p0-provider-ui-receipt-2026-10-24.md).

The current result is deliberately fail-closed. The observed TieSports public
OPA OEIRAS profile leads players to the TiePlayer mobile app; no browser player
calendar or explicit offer was observed. Rackets Pro Quinta da Marinha sends
its official `Reservar` link to `racket.id/home`, which rendered the RACKET ID
OFFICE landing page rather than a player booking flow. Smashpro exposes a
public directory/search path, but the observed Quinta da Marinha profile is
unclaimed and did not yield an authoritative calendar, free time or price.

Accordingly this companion continues to accept **only Playtomic** rendered-row
observations. TieSports/TiePlayer, Racket ID and Smashpro must not be treated
as connected sources until their own player UI, provider delegation,
availability/price redisplay and revocation requirements have been approved.
