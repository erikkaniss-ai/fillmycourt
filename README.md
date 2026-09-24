# FillMyCourt

Revenue infrastructure for racket clubs.

## Source release: 3.5.0 — unified identity v1

One master logo and asset system now serves the product website, FillMyCourt's Olsen Steiner portfolio presentation and LinkedIn. See `BRAND-IDENTITY.md` and `assets/fmc-brand-v1/identity.json`.

- F-tile and outlined FillMyCourt wordmark; do not recreate with font text.
- Navy #071E33, blue #1267E5, cyan #35A7FF, pale #F4F8FD and white.
- More play. Higher revenue.
- Shared capacity-slot motif; illustrations are not client performance data.
- 97 HTML pages updated, including PT/EN/ES/LV, with product logic and form endpoints preserved.
- Responsive menus, header sizing, hero hierarchy and onboarding overflow corrected.
- LinkedIn Page logo 400x400, Page cover 1512x256, post 1200x1200 and URL preview 1200x627.

Browser QA: 194 checks across 97 pages at 390px and 1440px, no detected layout/JavaScript failures or broken images. No forms were submitted. Details: `docs/BRAND-QA-v1.json`.

## Production is a separate verification

A GitHub source update is NOT a confirmed Netlify deployment. At the branding audit, fillmycourt.com was still serving the old deploy `6aaedb41941aa8202f985d2a`.

Existing Netlify project: fillmycourt
Site ID: 72eee365-bff0-48ec-bb8f-f08ff01341b7
Repository: erikkaniss-ai/fillmycourt
Production branch: main
Build command: empty (static HTML/CSS/JS)
Publish directory: .
Base directory: empty

Use the existing project and domain, not a new site. Confirm the published commit and the new `/assets/fmc-brand-v1/identity.json` before claiming production is updated.

## Source rule

Future work starts from main or a verified descendant. Preserve the underlying revenue-recovery, CRM, booking, loyalty, white-label, distribution and enterprise architecture; this release is an identity and responsive-presentation update, not a change in product scope.
