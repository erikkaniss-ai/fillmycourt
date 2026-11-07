# GetACourt MVP — Leaflet map CSP and SRI QA

Date: 2026-10-15. Isolated source-only compatibility/security patch; no architecture changes or live provider activity.

P0 root cause: existing GetAcourt HTML loads Leaflet 1.9.4 JavaScript and CSS from https://unpkg.com, but GetAcourt's Netlify Content-Security-Policy permitted only 'self' for script-src/style-src. Browser receiving this header cannot load Leaflet and silently returns from renderMap when window.L is absent, leaving blank map view.

Change: netlify.toml grants https://unpkg.com only for script-src and style-src. Removed obsolete script-src 'unsafe-inline' (Get JS has external scripts and DOM listeners). Strict connect-src 'self', form-action 'self', frame-ancestors 'none', geolocation=(self), camera/mic denied remain enforced. Pinned Leaflet CSS and JS versions 1.9.4 with the official upstream SHA-256 SRI hashes and crossorigin anonymous. Missing Leaflet runtime now switches player back to the visible list and presents a nonfatal toast.

Official reference: https://leafletjs.com/download.html. CSP: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src.

CI: source contract checks CSP exact allowed source, SRI, external asset ordering and missing map fallback. No network-based map CDN audit, actual browser test or physical geolocation consent performed. The publicly deployed GetAcourt branch remains unchanged and cannot display this fix until authorized deployment.
