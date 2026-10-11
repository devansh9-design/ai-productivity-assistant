-- Restrict direct REST execution of SECURITY DEFINER trigger functions.
--
-- handle_new_user runs from a trigger on auth.users and rls_auto_enable runs
-- from a DDL event trigger. Neither is meant to be called directly, but
-- PostgreSQL grants EXECUTE to PUBLIC by default, which exposes them through
-- PostgREST at /rest/v1/rpc/<name> to the anon and authenticated roles.
-- Revoking that grant closes the exposure; the trigger paths are unaffected
-- because SECURITY DEFINER functions run as their owner regardless of who
-- (or what) fires the trigger.
--
-- rls_auto_enable exists only on the deployed database (it was applied via the
-- dashboard and never committed here); the guards below keep this migration
-- safe to apply to a clean database built from this repository alone.

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'handle_new_user'
  ) then
    revoke all on function public.handle_new_user() from public, anon, authenticated;
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
