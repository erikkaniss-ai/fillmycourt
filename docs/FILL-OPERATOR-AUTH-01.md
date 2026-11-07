# FILL-OPERATOR-AUTH-01 — private operator password login (source-only until CI/deploy)

## Scope
Only existing protected FillMyCourt Netlify preview site d763b7a1-dccd-4638-8876-ac1670171698. No new site or paid infrastructure. The separate GetACourt project and public fillmycourt.com remain unchanged.

## Implementation
- POST /api/fmc-auth/login is a dedicated, staging-site-ID-locked Netlify Function. It forwards strictly bounded email/password credentials to the official Supabase GoTrue password grant using the staging project's **public** sb_publishable key. There is NO service-role or Supabase secret key; no sign-up, reset, test-user creation or membership writes.
- The function validates same-origin, method, JSON size/shape, and returns only short-lived access_token/expires_in. It discards any refresh token, hides user-enumeration details, and sets no-store/no-CORS headers. The existing business gateway remains entirely GET-only and pinned to Railway Operations.
- Operator sign-in form uses same-origin request and sessionStorage for new access tokens, never URL fragments or persistent localStorage on the new flow. Legacy injected-token support temporarily remains to avoid breaking fixture regression tests. Sign-out clears both stores.
- After sign-in, the app verifies /api/me, /api/fmc/organizations and organization role through existing Railway Operations data-authority; membership absence leaves a visible error. A valid Supabase login by itself does not grant operator rights.
- Synthetic fixture mode uses zero network calls and does not create credentials; CI browser tests route all network to mocked fixture responses. No real email is sent or user created.

## Acceptance gates
Code contract tests and Chromium workflow must pass on the exact SHA. Protected draft Netlify alias must return anonymous HTTP401, with public site unchanged. Actual end-to-end login still requires an OWNER-provisioned Supabase staging user and explicit public.organization_members membership, through supported admin processes (not direct auth.users SQL). Password/token must never be pasted into chat. No booking/payment/CRM/provider writes.

Source-only documentation is NOT evidence of actual authenticated operator acceptance.
