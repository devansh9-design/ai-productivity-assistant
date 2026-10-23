-- Phase 2 Step 12 database behaviour tests: the shared daily AI cap and
-- account deletion leaving no rows behind.
--
-- Runs in CI after every migration has been applied to a throwaway Postgres
-- (see .github/workflows/migrations-clean-db.yml). It replaces the CI stub's
-- auth.uid() so it can act as different signed-in users; never run it
-- against a real Supabase project. Fails if any check fails.
-- Test harness only: let auth.uid() read a session setting.
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
insert into auth.users (id, email) values
  ('a1a1a1a1-0000-4000-8000-0000000000a1', 'launch-a@test'),
  ('b2b2b2b2-0000-4000-8000-0000000000b2', 'launch-b@test'),
  ('c3c3c3c3-0000-4000-8000-0000000000c3', 'launch-c@test')
on conflict (id) do nothing;
-- Safe to rerun: start these users with no logged requests.
delete from public.ai_request_log where user_id in ('a1a1a1a1-0000-4000-8000-0000000000a1', 'b2b2b2b2-0000-4000-8000-0000000000b2');

create temp table launch_results (name text, ok boolean, detail text);
grant all on launch_results to authenticated, anon;

-- 1. Who may call the new claim function.
insert into launch_results select 'anon cannot call the shared-cap claim',
  not has_function_privilege('anon', 'public.claim_ai_request(integer, integer, integer)', 'execute'), '';
insert into launch_results select 'signed-in users can call the shared-cap claim',
  has_function_privilege('authenticated', 'public.claim_ai_request(integer, integer, integer)', 'execute'), '';

-- 2. The shared cap counts every user's requests in the current Gemini day.
-- Earlier test files may have logged requests today, so the cap is set
-- three above whatever is already there.
create temp table launch_cap as
  select count(*)::integer + 3 as cap from public.ai_request_log
  where created_at >= date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
grant select on launch_cap to authenticated;

set role authenticated;
set test.uid = 'a1a1a1a1-0000-4000-8000-0000000000a1';
insert into launch_results select 'user A claim 1 allowed', public.claim_ai_request(10, 10, (select cap from launch_cap)) = '{"retry_after": 0}', '';
insert into launch_results select 'user A claim 2 allowed', public.claim_ai_request(10, 10, (select cap from launch_cap)) = '{"retry_after": 0}', '';
set test.uid = 'b2b2b2b2-0000-4000-8000-0000000000b2';
insert into launch_results select 'user B claim 1 allowed', public.claim_ai_request(10, 10, (select cap from launch_cap)) = '{"retry_after": 0}', '';
do $$ declare answer jsonb := public.claim_ai_request(10, 10, (select cap from launch_cap)); begin
  insert into launch_results values ('user B is refused once everyone together reaches the cap',
    answer->>'scope' = 'global' and (answer->>'retry_after')::integer between 1 and 90000, answer::text);
end $$;
insert into launch_results select 'a refused claim is not logged',
  (select count(*) = 1 from public.ai_request_log where user_id = 'b2b2b2b2-0000-4000-8000-0000000000b2'), '';

-- 3. Personal limits still come first and say which one was hit.
do $$ declare answer jsonb := public.claim_ai_request(1, 10, 100000); begin
  insert into launch_results values ('the minute limit is reported as minute', answer->>'scope' = 'minute', answer::text);
end $$;
do $$ declare answer jsonb := public.claim_ai_request(10, 1, 100000); begin
  insert into launch_results values ('the daily limit is reported as day', answer->>'scope' = 'day', answer::text);
end $$;

-- 4. Signed-out callers cannot claim, and nobody can read others' requests.
insert into launch_results select 'user B sees only their own requests',
  (select bool_and(user_id = 'b2b2b2b2-0000-4000-8000-0000000000b2') from public.ai_request_log), '';
set role anon;
set test.uid = '';
do $$ begin
  perform public.claim_ai_request(10, 10, 10);
  insert into launch_results values ('signed-out caller cannot claim', false, 'no error');
exception when others then insert into launch_results values ('signed-out caller cannot claim', left(sqlstate, 2) = '42', sqlstate || ' ' || sqlerrm); end $$;
reset role;

-- 5. Every user-owned table is cleared when the account is deleted.
insert into launch_results select 'every reference to auth.users deletes with the user',
  coalesce(bool_and(c.confdeltype = 'c'), true),
  coalesce(string_agg(c.conrelid::regclass::text, ', ') filter (where c.confdeltype <> 'c'), '')
  from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
  where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and n.nspname = 'public';
insert into launch_results select 'every public table with user_id references auth.users',
  count(*) = 0, coalesce(string_agg(cols.table_name, ', '), '')
  from information_schema.columns cols
  where cols.table_schema = 'public' and cols.column_name = 'user_id'
    and cols.table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
    and not exists (
      select 1 from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
        and c.conrelid = ('public.' || quote_ident(cols.table_name))::regclass and a.attname = 'user_id');

set role authenticated;
set test.uid = 'c3c3c3c3-0000-4000-8000-0000000000c3';
insert into public.goals (id, title, category) values ('c3000000-0000-4000-8000-000000000001', 'Gym', 'fitness');
insert into public.goal_metrics (goal_id, name, unit, aggregation) values ('c3000000-0000-4000-8000-000000000001', 'Workouts', null, 'sum');
insert into public.tasks (title, goal_id) values ('Leg day', 'c3000000-0000-4000-8000-000000000001');
insert into public.checkins (checkin_date, type, energy_level) values ('2026-10-23', 'morning', 'high');
select public.claim_ai_request(10, 10, 100000);
reset role;

delete from auth.users where id = 'c3c3c3c3-0000-4000-8000-0000000000c3';
do $$
declare
  t text;
  left_over bigint;
  total bigint := 0;
  tables text := '';
begin
  for t in
    select cols.table_name from information_schema.columns cols
    join information_schema.tables tabs on tabs.table_schema = cols.table_schema and tabs.table_name = cols.table_name
    where cols.table_schema = 'public' and cols.column_name = 'user_id' and tabs.table_type = 'BASE TABLE'
  loop
    execute format('select count(*) from public.%I where user_id = %L', t, 'c3c3c3c3-0000-4000-8000-0000000000c3') into left_over;
    if left_over > 0 then total := total + left_over; tables := tables || t || ' '; end if;
  end loop;
  insert into launch_results values ('deleting a user leaves none of their rows', total = 0, tables);
end $$;

select (case when ok then 'PASS' else 'FAIL' end) || '  ' || name || case when ok or detail = '' then '' else '  [' || detail || ']' end from launch_results;

do $$ begin
  if exists (select 1 from launch_results where not ok) then
    raise exception 'Launch readiness database tests failed';
  end if;
end $$;
