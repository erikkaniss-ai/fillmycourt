# GetACourt — MVP geolocation / near-me security and UX QA

Date: 2026-10-15. Bounded source-only bug fix in existing Get release candidate; NOT an architecture change or approved public release.

Root cause: GetAcourt Netlify Permissions-Policy contained geolocation=() disabling navigator.geolocation even on genuine click and with the user's permission. The core user promise includes nearest-club search, so this is P0.

Fix: same-origin-only geolocation=(self); camera and microphone remain denied, no cross-origin iframe access. The browser independently prompts the user on clicking Near me. No location capture on page startup; coordinate data only sent with explicitly initiated search. Results from invalid/out-of-range coordinates are rejected client side, while the existing Netlify search endpoint also rejects them. Typing a city while a browser location request is pending cancels the stale callback by request epoch. Permission denial enables manual city search without trapping button state.

CI: Node VM actual Near me source tests; checked headers, explicit triggering, valid GPS source, invalid values, denied permission and stale geolocation requests. Neither browser prompt nor production host headers can be proven by source tests; need private candidate browser QA and physical iPhone/Android consent tests.

Release gate: no change to Playtomic/provider access, club data, public getacourt.com, booking/payment flags, Google OAuth configuration, credentials or architecture without separate owner GO.
