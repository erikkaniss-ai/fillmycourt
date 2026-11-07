# Portugal P0 provider UI receipt — 24 October 2026

Scope: browser-only, low-frequency observation of official public and player
entry surfaces. No provider API, undocumented endpoint, credential, cookie,
token, CAPTCHA bypass, booking, payment, message, upload, deployment or
production action was used. A visible player UI observation is not a provider
API response, current full inventory, a license to redistribute a price, or a
booking authority.

## Result

All three additional P0 providers are **STOP / no GetACourt reader**. The safe
current route is club-authorised, native FillMyCourt/Core inventory with Core
as the one booking writer. Their user-facing paths may be revisited only after
provider-specific delegation, revocation, rate/freshness, price/redisplay and
Portugal-coverage rights are independently approved.

The existing Playtomic companion remains the only local prototype. It is still
one manually-approved public club tab, one explicit expanded-offer read at a
time and no more than once per 60 seconds; it has no provider HTTP, token,
background polling, persistence beyond the chosen public club URL, booking or
payment ability. Its real Chrome-to-local-Get acceptance is **NOT RUN**.

## Observed official paths

| Provider | Official route checked | Confirmed visible facts | Availability / price outcome | Decision |
| --- | --- | --- | --- | --- |
| TieSports / TiePlayer | <https://clubs.tiesports.com/pt/lisboa/OeirasPadelAcademy> and <https://www.tiesports.com/tieplayer> | OPA OEIRAS is listed at Rua Joaquim Paço de Arcos, with 17 indoor/outdoor padel/pickleball courts and 08:00–23:00 hours. TiePlayer advertises player court bookings and payment in the mobile app, with App Store and Google Play routes. | No browser player sign-in/registration, selected date, court calendar, explicit free slot or price was exposed on these observed public pages. | STOP. Do not infer availability from a directory, operating hours or app marketing. |
| Racket ID | <https://www.racketspro.pt/quinta-da-marinha> → <https://racket.id/home> | Rackets Pro’s own Quinta da Marinha page identifies 9 padel courts (6 covered) and links its `Reservar` action to `racket.id/home`. The destination rendered the public `RACKET ID OFFICE` landing page, not an identifiable player booking flow. | No player registration method, selected club calendar, free court/time, duration or current price was exposed at the linked web destination. | STOP. The official club deep link is recorded, but it is not a proven player availability interface. |
| Smashpro | <https://smashpro.pt/pt/l/padel/portugal/cascais> → <https://smashpro.pt/pt/c/rackets-pro-academy-quinta-da-marinha> | Smashpro publicly lists the Cascais club and a public search surface with sport, location and date/duration controls. The club page labels the profile unclaimed. | No authenticated player sign-in/registration or official club-controlled calendar, explicit free time or price was returned on the observed club page. The unclaimed directory profile is not authoritative supply. | STOP. Keep it out of automated reads and do not treat its directory record as live inventory. |
| Playtomic | <https://playtomic.com/clubs/cascais-padel-club> → official login | The club page exposes a calendar surface and a sign-in link. The official login page visibly offers Apple, Google and Facebook; the Chrome profile displayed the user’s Google account chooser. | Google/OAuth/MFA was deliberately not clicked or completed by the worker. The unauthenticated club page contained no explicit expanded price offer in this session. | User may personally complete official Google/OAuth/MFA; then a manual browser read remains pending local companion acceptance and does not become licensed inventory. |

## Acceptance and operational limits

1. A user may complete only their own official Google/OTP/MFA screens. Do not
   put passwords, OTPs, cookies, access tokens or refresh tokens into
   GetACourt, a chat or source control.
2. The worker must stop before any `Book`, `Continue`, checkout, payment,
   phone verification or CAPTCHA step. Current P0 observations include no
   real reservation, hold or account creation.
3. `getacourt/assets/personal-source-observation.js` verifies that the local
   reader can render only its narrow Playtomic expanded-row schema. TieSports,
   Racket ID and Smashpro are explicitly rejected; their names in this receipt
   are research, not integrations.
4. Before a future provider adapter: obtain a provider/club contract, exact
   user-delegation scope, read/revocation lifecycle, documented request and
   freshness budgets, availability and price/redisplay rights, security/DPA
   approval, named Portugal club coverage and explicit owner GO.

## Engineering verification

Run locally from the repository root:

```sh
node --test getacourt/tests/personal-playtomic-reader.test.mjs getacourt/tests/personal-source-observation.test.mjs
node --check getacourt/assets/personal-source-observation.js
```

These are source-only contracts. They prove the fail-closed display boundary;
they do not prove provider authorization, authenticated UI success, mobile
acceptance, a live slot, price freshness, a deployment or a release.
