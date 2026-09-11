-- 20260910133000_add_telegram_chat_mappings.sql already installs an
-- updated_at trigger. Remove the duplicate trigger added by the later
-- check-in migration so each mapping update executes one trigger only.
drop trigger if exists telegram_chat_mappings_set_updated_at on public.telegram_chat_mappings;
