# GAC-MVP-QA-10 — fail-closed provider booking guard

Owner-approved source authority invariant: one authoritative booking writer per court interval (Decisions #1-#104). No provider-owned booking architecture, adapter, payment or provider write is authorized.

Prior source UI gated checkout on a single global `bookingEnabled` flag; a future partner/directory venue with externally supplied slot could therefore be presented as a native Core checkout candidate. QA-10 blocks this at the front-end interaction boundary whenever slot.provider !== `fillmycourt`. It provides an explicit non-transactional notice and never calls hold/confirm or proposes a guessed external booking link. Back-end Core native writer and protected route permissions stay unchanged.

New Node contract and real Chromium fixture E2E assert the negative case with bookingEnabled=true, a simulated signed-in player, and a provider-owned Playtomic-like slot. No provider token, provider API request or transaction is performed. Existing fixture-only UI with bookingEnabled=false still shows a clearly disabled preview.

This is defense-in-depth, not proof of a future provider authorization. Real external availability rights, club catalog, official booking-link validation and server-side booking authority remain separate P0.

Production Get branch, main, Netlify, Railway, Supabase, real provider connections and product decisions must remain unchanged. Only release-candidate source plus CI tests.
