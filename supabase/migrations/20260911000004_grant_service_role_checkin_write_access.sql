-- The Telegram check-in route uses the Supabase service_role client for direct writes.
-- Keep these grants in migration history so fresh environments receive the same
-- permissions as production.
grant select, insert, update on table public.checkins to service_role;
grant select, insert, update on table public.journal_entries to service_role;
