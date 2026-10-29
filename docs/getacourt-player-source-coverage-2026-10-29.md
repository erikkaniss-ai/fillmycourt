# GetACourt player-side provider coverage — 29 Oct 2026 (NON-PUBLIC SOURCE STATUS)

**User mandate:** All major platforms through **each player's normal official login / permitted user-visible app or website**, one login/host grant per provider then a simple GetACourt Find search. Selected offer hands off to the provider's official booking page. No direct provider/club API, login cookie export, hidden endpoint, server-side account impersonation, booking/payment, external outreach or invented live inventory (Product Decisions #105/#106).

## Verified actual source coverage vs code contracts

| Provider | Verified official consumer surface | Current Get source truth | Engineering next gate |
|---|---|---|---|
| Playtomic | Consumer player account and club pages, normal Chrome/Edge browser | v0.3.0 **one approved club**, 4/4 CI and private staging with synthetic UI; REAL signed-in full-search UAT pending | First-party player session + live dated priced offer, then search across multiple clubs, without repetitive grants |
| TieSports / TiePlayer | TieSports official club web booking directory; TiePlayer mobile app | Club pages verified, not live priced inventory; safe distinct provider observation contract + fictional visible-row parser | Test normal player login and exact club booking date/price controls in real browser. Do not treat a coloured schedule or opening hours as free priced court |
| Racket ID | Official `racket.id/booking` JavaScript player portal; mobile app | Normal login and rendered court inventory not observed | Actual player UI access; no invented selectors/API; only explicitly priced time/court rows qualify |
| Smashpro | Club web catalogue; inspected Rackets Pro Quinta da Marinha is expressly **UNCLAIMED** | No authorised priced court source; unclaimed listings excluded from Get offers | Find a claimed, genuinely bookable player page and verify first-party login and price |
| MATCHi | Official `www.matchi.se/facilities/<slug>` player booking web | Named official facility routes and site search verified; native live EUR time/price rows not accepted | Real player booking session/visible dated row and country currency validation; no automatic EUR inference from SEK/NOK |

## Current technical change

The shared **player-visible observation schema** now recognizes separate first-party provider identifiers and narrow HTTPS booking-route allowlists; the normalizer preserves provider name, court, date, local label, explicit EUR total, source freshness=unknown, capture expiry (60 seconds), unknown timezone and authoritative official booking handoff. An unclaimed Smashpro directory entry must never become a verified court offer. Known club URL mappings must match a real club-page source; generic portals cannot be silently tied to a named club by URL.

The new `browser-companion/visible-provider-offers.js` parser is strictly **client-side, read-only and fail-closed**. It requires an ordinary visible booking UI with matching explicit date, sport, venue, court, 60/90min start/end and a **single total EUR price** on one actionable row. It rejects opening hours, colour-only calendars, sold-out rows, per-person prices, conflicts, wrong/cross-origin source routes and advertising/discount packages. Node tests use FICTIONAL snapshots. **This pure parser is not itself an authenticated connector. The 0.4.0 browser extension source adds named optional Chrome host grants per provider and an on-demand, fail-closed ordinary DOM reader for TieSports, Racket ID, Smashpro and MATCHi. The Get Find action now sends the additional-provider search request separately, with independent provider statuses and no false available labels. Actual provider login/DOM acceptance and completeness remain NOT VERIFIED.** It must be attached to each official UI only after its actual rendered structure is verified; a speculative selector is NOT evidence of real live capability. No hidden calls, credentials or provider writes.

## Real launch acceptance

1. Per provider, player signs in first-party once, grants named site access once, and Get Find runs via that user's own active browser session — no per-query clipboard, manual extension gestures or multi-player session sharing.
2. Actual fresh priced results from at least two platforms visible side by side, correct source+club+court+date+start+duration+EUR total and safe official booking handoff, no booking.
3. Provider expiry, timeout, CAPTCHA/MFA, missing source date/price and third-party access restriction must yield clear `NOT_CONNECTED/UNAVAILABLE`, **never** `sold_out` or a fabricated offer.
4. Real physical Chrome/Edge after restart, session isolation, revoke and mobile/PC-off limitation. An optional future secure remote agent requires separate approval and cannot be implied by a desktop Chrome extension.
5. No public/production release, payments, real booking, user messages, provider outreach or data import without distinct owner GO.

## Primary-source research (read-only, no contacts)

- TieSports club web directory: https://clubs.tiesports.com/en and official player product: https://www.tiesports.com/tieplayer
- Racket ID player platform: https://racket.id/booking and https://racket.id/home
- Smashpro example expressly unclaimed: https://smashpro.pt/pt/c/rackets-pro-academy-quinta-da-marinha
- MATCHi player web booking: https://www.matchi.se/ and official help: https://matchiplayers.zendesk.com/hc/en-gb/articles/11451472470301-Is-it-possible-to-make-a-booking-on-site
- Playtomic player booking UI: https://playerhelp.playtomic.com/hc/en-gb/articles/19831881490449-How-to-make-a-reservation-in-Playtomic-app

**Do not mistake a CI fixture, a directory, or one historical provider screenshot for current availability.**