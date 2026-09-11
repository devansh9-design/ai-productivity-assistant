-- Day 6: Corrective Migration for Google Calendar Integration
--
-- The google_credentials table is intended to be accessed ONLY via the
-- Supabase service_role client to keep tokens strictly out of the browser.
-- While RLS was enabled and no authenticated/anon policies were created,
-- the service_role lacked explicit CRUD privileges, causing runtime permission denied errors.
--
-- This migration explicitly grants SELECT, INSERT, UPDATE, DELETE to service_role.
-- It does NOT grant access to authenticated or anon roles.
-- RLS remains enabled.

GRANT SELECT, INSERT, UPDATE, DELETE 
ON TABLE public.google_credentials 
TO service_role;
