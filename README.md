# FillMyCourt

Revenue infrastructure for racket clubs.

**Website:** https://fillmycourt.com  
**Production host:** Netlify  
**Canonical source:** this repository

## Current release

**v3.4 — Blue Identity Refresh — 24 Sep 2026**

The v3.4 release aligns the product site with the new FillMyCourt visual identity:

- deep navy `#071E33`
- primary blue `#1267E5`
- electric blue `#35A7FF`
- pale blue `#EAF4FF`
- new FillMyCourt logo and favicon
- refreshed Open Graph artwork
- blue revenue / CRM / booking / analytics visual system
- preserved multilingual routes, SEO structure, tools, forms and product positioning

## Positioning

FillMyCourt is a revenue-first SaaS platform for racket-sport clubs, combining:

- revenue recovery automation
- behavioural CRM
- booking and inventory
- player retention and loyalty
- match formation
- distribution connectors
- white-label player experiences
- multi-location enterprise control

## Source rule

All future production changes should start from `main`. Do not deploy an older ZIP or archive over the canonical source.

## Deployment

The existing Netlify project is `fillmycourt` and production domain is `fillmycourt.com`.

Continuous deployment should use:

- repository: `erikkaniss-ai/fillmycourt`
- branch: `main`
- base directory: repository root
- build command: none
- publish directory: repository root
