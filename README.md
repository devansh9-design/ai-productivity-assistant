# Personal Productivity Assistant

Initial authenticated app shell for a private productivity assistant.

## Local setup

1. Create a Supabase project and enable Email authentication.
2. Copy `.env.example` to `.env.local` and fill in the Supabase URL and publishable key. Do not use or expose a service-role key in this application.
3. Apply `supabase/migrations/20260730000000_create_profiles.sql` through the Supabase CLI or SQL Editor.
4. In Supabase Auth URL Configuration, add `http://localhost:3000/auth/callback` and the matching production URL as redirect URLs.
5. Run `npm install` then `npm run dev`.

The Supabase publishable/anon key is intentionally browser-visible and is protected by Row Level Security. All private credentials must remain server-only and outside version control.

## Day 2 review fixes

A security/quality review of the Day 2 data model turned up 10 findings, all addressed here:

1. **Apply the new migrations, in order**, after the original two:
   - `20260731000001_grant_authenticated_privileges.sql` — fixes `permission denied for table goals` (and the other Day 2 tables): RLS policies only filter rows once a role can already touch a table, and the `authenticated` role was never `GRANT`ed base-level privileges on it.
   - `20260731000002_cross_user_fk_validation.sql` — adds trigger-based validation so a foreign key (e.g. `projects.goal_id`) can never point at another user's row, which RLS alone does not prevent.
   - Every migration from this point forward uses an idempotent pattern (`create or replace function`, `drop trigger if exists` before `create trigger`, `drop policy if exists` before `create policy`) so a replayed or partially-applied migration can't fail on "already exists."
2. **RLS regression test** — `npm run test:rls` runs `scripts/rls-regression-test.mjs` against a real Supabase project using two test accounts, asserting SELECT/INSERT/UPDATE/DELETE isolation and the new cross-table FK isolation. It needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and credentials for two disposable test accounts — see the script header for details. This exercises real Postgres RLS, so it can't be a mocked unit test.
3. **Clean-database migration check** — `.github/workflows/migrations-clean-db.yml` spins up a bare Postgres service container in CI, stubs just enough of Supabase's `auth` schema to satisfy foreign keys (`scripts/ci-auth-schema-stub.sql`), and applies every migration in order, failing the build on any SQL error.
4. **Duplicate submissions** — the four "create" forms (goals, projects, milestones, tasks) now use `<SubmitButton>` (`components/submit-button.tsx`), which disables itself the instant the Server Action starts, closing the double-click/double-tap path to duplicate rows.
5. **Timezone-correct "Today"/"Overdue"/"Due soon"** — `lib/tasks/filters.ts` now compares plain `YYYY-MM-DD` strings instead of constructing `Date` objects on the server's local clock. `components/timezone-sync.tsx` writes the browser's IANA timezone to a `tz` cookie once; the Tasks page reads it and computes "today" via `lib/tasks/timezone.ts`, which is covered by DST-transition, leap-day, and cross-timezone tests in `lib/tasks/filters.test.ts`.
6. **Defense-in-depth authorization** — every update/delete Server Action now filters by `.eq("user_id", user.id)` in addition to `.eq("id", id)`. RLS already blocks cross-user writes; this avoids relying on RLS as the only layer.
7. **Shared auth helper** — `requireUser()` now lives once in `lib/auth/require-user.ts` instead of being duplicated across the goals/projects/milestones/tasks action files.
