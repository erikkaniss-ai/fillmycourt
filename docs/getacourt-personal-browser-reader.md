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
   GetACourt. Copy its public extension ID into the local GetACourt page.
4. Press **Read expanded offers**. Only the previously approved tab and club
   may be read. At least 60 seconds separates attempts, including failures
   after tab validation. This is our conservative limit, not a provider rate
   entitlement. The companion does not navigate, refresh or click the provider.
5. **Disconnect and clear** revokes the stored club approval, clears the tab
   grant and prevents late in-flight completion. The popup also offers
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
request a read or revoke. Web pages cannot grant consent; only the packaged
popup can. Request fields are allowlisted. All result strings render as text.
External action names, provider URLs, scripts, credentials or booking methods
cannot be supplied. The 60-second budget, single-flight guard and revocation
epoch reject bursts, simultaneous reads and late withdrawn responses.

This is personal assistance under the user's explicit opt-in. Provider API
delegation, automated product redistribution and commercial supply rights
remain separate. No legal or provider approval is inferred from this code.

## Verification and remaining acceptance

`node --test getacourt/tests/personal-playtomic-reader.test.mjs` exercises consent,
exact sender/port/path/frame, forbidden requests, cooldown, lost tab context,
revoke cleanup, in-flight withdrawal and conservative visible-row parsing.
It is registered in fast, integration and full Platform CI. Fixtures are
fictional; there is no real account or observed live offer in the repository.

Installation and real Chrome/Edge activeTab-to-local-Get readback must still
be performed with user approval. VM tests do not establish browser permission
acceptance or a live connection. No deployment is needed for local acceptance.

## Other provider findings, 22 October 2026

Racket ID offers a selection stage that exposes court name, duration and price
before its Continue action. The read-only investigation stopped before
Continue and closed the selection. Availability indicators alone should not
be parsed as an offer; an explicit court selection sheet is required.

TieSports has an official browser directory at <https://clubs.tiesports.com/en>.
Its club pages expose **Book Online**, a date/time selector, court accordions,
and duration/price options. Opening those controls is discovery; selecting a
duration and proceeding is excluded from the reader. This resolves the prior
incorrect assumption that TiePlayer access was mobile-only. The signed-in
club management page with venue `None` is a separate surface.
