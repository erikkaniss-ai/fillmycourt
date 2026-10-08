create index if not exists bookings_player_fk_idx on public.bookings(player_id) where player_id is not null;
create index if not exists payments_booking_fk_idx on public.payments(booking_id) where booking_id is not null;
