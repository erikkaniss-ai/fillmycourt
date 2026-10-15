# Playtomic and player sign-in — verified implementation boundaries

Official material checked during this work, 4 October 2026:

- https://helpmanager.playtomic.com/hc/en-gb/articles/47390286355089-Third-party-integrations-and-Playtomic-Connect
- https://third-party.playtomic.io/endpoints/auth/
- https://third-party.playtomic.io/endpoints/bookings/
- https://third-party.playtomic.io/endpoints/players/
- https://third-party.playtomic.io/endpoints/payments/
- https://developers.google.com/identity/openid-connect/openid-connect
- https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web

## Important change since the earlier project discussion

Playtomic's 2 October article describes tighter controls on unauthorized integrations and its
Connect certification route. Do not treat self-issued club credentials as blanket permission to
redistribute the marketplace or write bookings. Earlier general guides described Players/Payments
as future additions; current technical documentation now describes both endpoints. Resolve any
account-specific differences through the authorized pilot, not a guessed undocumented fallback.

## Adapter implemented

API origin: https://thirdparty.playtomic.io
OAuth: POST /api/v1/oauth/token, JSON {client_id, secret}; response token, expires_in.
Bookings: GET /api/v1/bookings, tenant_id and booking-date window, page/size <=200.
Players: GET /api/v1/venues/{venue_id}/players, cursor_id/limit <=100.
Payments: GET /api/v1/payments, tenant_id, payment-date window, cursor_id/limit <=100.

Players documentation contains a singular /venue in an example but plural /venues in the
endpoint specification. The implementation follows the endpoint specification. Verify with real
club credentials; do not silently probe undocumented alternatives or scrape login sessions.

Payments may first return 202 + Retry-After while building an export. The worker defers and
retains its checkpoint. Payments is a reporting feed, not a PSP: it does not charge, refund or
transfer. Nested null fields are handled; monetary values are parsed in integer minor units.
Payout references and provider net transfer amounts are evidence, not proof of bank receipt.
The published payment schema contains no guaranteed booking ID. Reports therefore remain
unlinked until an exact documented mapping is provided—no amount/name/time fuzzy match.

Customer consent is venue-specific. A false accepts_commercial_communications means no
marketing permission; it is not asserted to be a historical withdrawal. Customer records are staged
for operator review, not silently converted into GetACourt logins or outreach targets.

## Club credentials

Configure a trusted deployment binding before the venue owner saves the integration:

PLAYTOMIC_CLUB_A_FMC_VENUE_ID=<local verified venue id>
PLAYTOMIC_CLUB_A_TENANT_ID=<provider authorized venue id>
PLAYTOMIC_CLUB_A_CLIENT_ID=<secret store value>
PLAYTOMIC_CLUB_A_CLIENT_SECRET=<secret store value>

The owner enters only credential_ref=PLAYTOMIC_CLUB_A, tenant_id and authorization_ref.
Both API and worker verify the binding. A club cannot choose an arbitrary reference to another
club's secrets. No keys are exposed in frontend config, reports or access logs.

**Actual account connection has not been performed:** no pilot club credentials or Connect
approval were available in the inspected deployment. Contract tests use official-format fixtures.
There is no Playtomic availability/write adapter in this release. Its booking data is not marketed
as all free court slots. Native GetACourt inventory works through the shared FmC booking core.
The existing developer's finder can be connected by the separate contract in API-CONTRACT.md.

## Google / Apple onboarding

Implemented: server-side authorization-code flow; Google PKCE; state/browser binding; one-use
state; nonce; issuer/audience/expiry/azp checks; provider JWKS signature verification; HttpOnly
host-only sessions; persistent profile/terms acceptance; separate marketing opt-in.
Identity key is provider + subject. Same email across Google/Apple does not auto-link accounts.
Apple private relay email is supported. No demo role selector or anonymous booking identity exists.

Register exact callbacks on each actual deployed domain (proposed domains below):
https://getacourt.com/api/auth/google/callback
https://getacourt.com/api/auth/apple/callback
https://workspace.fillmycourt.com/api/auth/google/callback
https://workspace.fillmycourt.com/api/auth/apple/callback

Google requires a project/client credentials and approved redirect URIs. Apple requires the
appropriate developer configuration, Services ID, associated App ID/domain settings and signing
key. No paid membership was purchased and no account configurations were fabricated.

Live login remains disabled until credentials and published legal information are configured.
Unit tests validate cryptographic success/failure with generated test keys; they do not claim a
real Google or Apple account completed signup on getacourt.com. Email-link authentication can
be added after a verified outbound-mail setup; it is not shipped as an insecure simulated OTP.
