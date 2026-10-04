# GetACourt product benchmark — October 2026

## Player-side baseline seen in leading racket platforms

### Playtomic
- Search by sport/location/date/time.
- Court/duration selection.
- Private booking and open matches.
- Split payment / pay own part.
- Cancellation policy in checkout.
- Club profiles and activities.

### MATCHi
- Nearby venue + available-time discovery.
- Court booking and payment.
- Activities, memberships/passes, coaches.
- Member vs non-member pricing.
- Split-payment style workflows visible in club migrations/support references.

### Anybuddy
- Nearby real-time availability across partner clubs.
- No-membership pay-and-play positioning.
- Secure online payment.
- Public matches / partner finding.
- Split payment.
- Multi-sport: tennis, padel, badminton, squash, pickleball/table tennis.
- Access-code integrations at some venues.

### Sportyfriends
- Court booking, recurring bookings and booking windows.
- Activities/waitlists.
- Memberships and payments.
- QR/access codes, lights/access control.
- Native apps and notifications.

### Playbypoint
- Rich reservation rules, waitlists and add-ons.
- Split/group payments.
- Open-match / rating-based matchmaking.
- Coach booking and lesson packages.
- White-label app, membership, POS and access control.

## GetACourt design rule

Do not recreate every platform on day one. The consumer wedge is faster cross-provider availability discovery. Build the booking core with the right entities, but keep the first player journey short:

1. Where / sport / when.
2. Compare actual available slots.
3. Hold.
4. Confirm players/payment choice.
5. Booking confirmation.

Open matches, split payment, activities and passes become modules on the same booking object rather than separate products.
