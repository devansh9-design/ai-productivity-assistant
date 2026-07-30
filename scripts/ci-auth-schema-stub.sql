-- Minimal stand-in for Supabase's built-in `auth` schema, used only by the
-- clean-database migration check in CI (see
-- .github/workflows/migrations-clean-db.yml). A plain Postgres service
-- container has no `auth` schema, but every migration in this project
-- references `auth.users(id)` as a foreign key target and calls
-- `auth.uid()` in policies/defaults. This stub provides just enough for
-- migrations to apply and for functions/triggers/policies to compile.
--
-- It is NOT a substitute for real RLS testing -- there is no real
-- authenticated session backing auth.uid() here, so it always returns
-- null. Actual policy behavior is covered by scripts/rls-regression-test.mjs
-- against a real Supabase project (Fix 7); this stub only proves the
-- schema itself builds cleanly (Fix 8).
-- Create Supabase roles for CI


DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END
$$;


create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select null::uuid;
$$;
