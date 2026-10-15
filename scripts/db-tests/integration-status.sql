-- Day 12 database behaviour tests for integration_status.
--
-- Runs in CI after every migration has been applied to a throwaway Postgres
-- (see .github/workflows/migrations-clean-db.yml). It replaces the CI stub's
-- auth.uid() so it can act as two different signed-in users; never run it
-- against a real Supabase project. Fails if any check fails.
-- Test harness only: let auth.uid() read a session setting.
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
insert into auth.users (id, email) values
  ('cccccccc-0000-4000-8000-000000000003', 'c@test'),
  ('dddddddd-0000-4000-8000-000000000004', 'd@test')
on conflict (id) do nothing;

create temp table status_results (name text, ok boolean, detail text);
grant all on status_results to authenticated, anon;

set role authenticated;
set test.uid = 'cccccccc-0000-4000-8000-000000000003';

-- 1. A first write creates the row with both switches on.
insert into public.integration_status (user_id, provider, last_read_at)
  values ('cccccccc-0000-4000-8000-000000000003', 'google_calendar', now());
insert into status_results select 'new row defaults to planning and publishing on',
  (select planning_enabled and publishing_enabled and not needs_reconnect from public.integration_status), '';

-- 2. The app's upsert updates only the columns it sends.
insert into public.integration_status (user_id, provider, planning_enabled, publishing_enabled)
  values ('cccccccc-0000-4000-8000-000000000003', 'google_calendar', false, true)
  on conflict (user_id, provider) do update set planning_enabled = excluded.planning_enabled, publishing_enabled = excluded.publishing_enabled;
insert into status_results select 'pause switch saved, last read kept',
  (select not planning_enabled and publishing_enabled and last_read_at is not null from public.integration_status), '';

-- 3. Errors must be a known code with a short message, recorded completely.
update public.integration_status set last_error_at = now(), last_error_operation = 'read',
  last_error_code = 'unavailable', last_error_message = 'Google Calendar didn''t respond. Try again in a moment.', needs_reconnect = false;
insert into status_results select 'complete error recorded', (select last_error_code = 'unavailable' from public.integration_status), '';

do $$ begin
  update public.integration_status set last_error_code = 'raw_google_error';
  insert into status_results values ('unknown error code rejected', false, 'no error');
exception when check_violation then insert into status_results values ('unknown error code rejected', true, sqlerrm); end $$;
do $$ begin
  update public.integration_status set last_error_message = repeat('x', 201);
  insert into status_results values ('message over 200 characters rejected', false, 'no error');
exception when check_violation then insert into status_results values ('message over 200 characters rejected', true, sqlerrm); end $$;
do $$ begin
  update public.integration_status set last_error_message = null;
  insert into status_results values ('partial error rejected', false, 'no error');
exception when check_violation then insert into status_results values ('partial error rejected', true, sqlerrm); end $$;
do $$ begin
  insert into public.integration_status (user_id, provider) values ('cccccccc-0000-4000-8000-000000000003', 'telegram');
  insert into status_results values ('unknown provider rejected', false, 'no error');
exception when check_violation then insert into status_results values ('unknown provider rejected', true, sqlerrm); end $$;
do $$ begin
  insert into public.integration_status (user_id, provider) values ('cccccccc-0000-4000-8000-000000000003', 'google_calendar');
  insert into status_results values ('one row per user and integration', false, 'no error');
exception when unique_violation then insert into status_results values ('one row per user and integration', true, sqlerrm); end $$;

-- 4. Another user can neither see, change, nor create rows for user C.
set test.uid = 'dddddddd-0000-4000-8000-000000000004';
insert into status_results select 'user D sees none of C''s status', (select count(*) = 0 from public.integration_status), '';
update public.integration_status set planning_enabled = true where user_id = 'cccccccc-0000-4000-8000-000000000003';
do $$ begin
  insert into public.integration_status (user_id, provider) values ('cccccccc-0000-4000-8000-000000000003', 'google_calendar');
  insert into status_results values ('user D cannot write a row for C', false, 'no error');
exception when insufficient_privilege then insert into status_results values ('user D cannot write a row for C', true, sqlerrm); end $$;
insert into public.integration_status (provider) values ('google_calendar');
insert into status_results select 'user D''s own row defaults to D', (select count(*) = 1 from public.integration_status where user_id = 'dddddddd-0000-4000-8000-000000000004'), '';

set test.uid = 'cccccccc-0000-4000-8000-000000000003';
insert into status_results select 'C''s pause was not changed by D', (select not planning_enabled from public.integration_status), '';

-- 5. Signed-out callers see nothing: no privilege, or no policy that matches.
reset role;
set role anon;
set test.uid = '';
do $$ declare visible bigint; begin
  select count(*) into visible from public.integration_status;
  insert into status_results values ('anon sees no integration status', visible = 0, visible || ' rows visible');
exception when insufficient_privilege then insert into status_results values ('anon sees no integration status', true, sqlerrm); end $$;
reset role;

select (case when ok then 'PASS' else 'FAIL' end) || '  ' || name || case when ok or detail = '' then '' else '  [' || detail || ']' end from status_results;

do $$ begin
  if exists (select 1 from status_results where not ok) then
    raise exception 'Integration status database tests failed';
  end if;
end $$;
