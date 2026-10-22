-- Phase 2 Step 2 database behaviour tests: sign-up and complete_onboarding.
--
-- Runs in CI after every migration has been applied to a throwaway Postgres
-- (see .github/workflows/migrations-clean-db.yml). It replaces the CI stub's
-- auth.uid() so it can act as two different signed-in users; never run it
-- against a real Supabase project. Fails if any check fails.
-- Test harness only: let auth.uid() read a session setting.
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create temp table onboarding_results (name text, ok boolean, detail text);
grant all on onboarding_results to authenticated, anon;

create or replace function pg_temp.expect_error(test_name text, statement text, sqlstate_prefix text) returns void language plpgsql as $$
begin
  execute statement;
  insert into onboarding_results values (test_name, false, 'no error');
exception when others then
  insert into onboarding_results values (test_name, left(sqlstate, 2) = sqlstate_prefix, sqlstate || ' ' || sqlerrm);
end $$;

-- 1. A new account gets a profile and no starter goals.
insert into auth.users (id, email) values
  ('33333333-0000-4000-8000-000000000033', 'new@test'),
  ('44444444-0000-4000-8000-000000000044', 'other@test')
on conflict (id) do nothing;
insert into onboarding_results select 'new account gets a profile, not yet onboarded',
  exists (select 1 from public.profiles where id = '33333333-0000-4000-8000-000000000033' and onboarded_at is null), '';
insert into onboarding_results select 'new account gets no starter goals',
  not exists (select 1 from public.goals where user_id = '33333333-0000-4000-8000-000000000033'), '';

set role authenticated;
set test.uid = '33333333-0000-4000-8000-000000000033';

-- 2. Completing onboarding saves the profile, timetable and goals together.
insert into public.availability_rules (weekday, kind, start_time, end_time) values (1, 'sleep', '23:00', '23:59');
select public.complete_onboarding('Asha', 2::smallint, 'Asia/Kolkata',
  '[{"weekday":1,"kind":"class","start_time":"09:00","end_time":"13:00"},
    {"weekday":1,"kind":"working","start_time":"18:00","end_time":"22:00"},
    {"weekday":3,"kind":"class","start_time":"10:00","end_time":"12:00"}]'::jsonb,
  '[{"title":"Gym","category":"fitness","target_date":"2026-12-31","weekly_hours":5},
    {"title":"DSA for placements","category":"placement"}]'::jsonb);
insert into onboarding_results select 'profile saved and marked onboarded',
  (select display_name = 'Asha' and college_year = 2 and timezone = 'Asia/Kolkata' and onboarded_at is not null from public.profiles), '';
insert into onboarding_results select 'timetable saved as class and study rules',
  (select count(*) = 3 from public.availability_rules where kind in ('class', 'working')), '';
insert into onboarding_results select 'rules the wizard does not manage are kept',
  (select count(*) = 1 from public.availability_rules where kind = 'sleep'), '';
insert into onboarding_results select 'goals created with category and a start date',
  (select count(*) = 2 and bool_and(start_date is not null) from public.goals)
  and (select category = 'fitness' and target_date = '2026-12-31' and weekly_hours = 5 from public.goals where title = 'Gym'), '';

-- 3. Re-running onboarding replaces the timetable, adds goals, keeps the first onboarding time.
create temp table first_onboarded as select onboarded_at from public.profiles;
select public.complete_onboarding('Asha K', 3::smallint, 'Asia/Kolkata',
  '[{"weekday":2,"kind":"class","start_time":"09:00","end_time":"11:00"}]'::jsonb, null);
insert into onboarding_results select 'second run replaces the timetable',
  (select count(*) = 1 from public.availability_rules where kind in ('class', 'working')), '';
insert into onboarding_results select 'second run keeps goals and first onboarding time',
  (select count(*) = 2 from public.goals) and (select p.onboarded_at = f.onboarded_at from public.profiles p, first_onboarded f), '';
select public.complete_onboarding('Asha K', 3::smallint, 'Asia/Kolkata', null, null);
insert into onboarding_results select 'a null week leaves the timetable unchanged',
  (select count(*) = 1 from public.availability_rules where kind = 'class'), '';

-- 4. Bad input is rejected and changes nothing.
select pg_temp.expect_error('unknown timezone is rejected',
  $q$select public.complete_onboarding('A', 1::smallint, 'Mars/Olympus', null, null)$q$, '22');
select pg_temp.expect_error('onboarding cannot set sleep or other kinds',
  $q$select public.complete_onboarding('A', 1::smallint, 'UTC', '[{"weekday":1,"kind":"sleep","start_time":"01:00","end_time":"02:00"}]', null)$q$, '22');
select pg_temp.expect_error('a class cannot end before it starts',
  $q$select public.complete_onboarding('A', 1::smallint, 'UTC', '[{"weekday":1,"kind":"class","start_time":"12:00","end_time":"10:00"}]', null)$q$, '23');
select pg_temp.expect_error('weekday must be 0-6',
  $q$select public.complete_onboarding('A', 1::smallint, 'UTC', '[{"weekday":7,"kind":"class","start_time":"09:00","end_time":"10:00"}]', null)$q$, '23');
select pg_temp.expect_error('college year must be 1-6',
  $q$select public.complete_onboarding('A', 9::smallint, 'UTC', null, null)$q$, '23');
select pg_temp.expect_error('goal category must be known',
  $q$select public.complete_onboarding('A', 1::smallint, 'UTC', null, '[{"title":"X","category":"sleep"}]')$q$, '23');
select pg_temp.expect_error('at most 10 goals at once',
  $q$select public.complete_onboarding('A', 1::smallint, 'UTC', null, (select jsonb_agg(jsonb_build_object('title', 'G' || i)) from generate_series(1, 11) i))$q$, '22');
insert into onboarding_results select 'rejected runs changed nothing',
  (select display_name = 'Asha K' and college_year = 3 from public.profiles)
  and (select count(*) = 1 from public.availability_rules where kind = 'class') and (select count(*) = 2 from public.goals), '';

-- 5. Another student's onboarding touches only their own rows.
set test.uid = '44444444-0000-4000-8000-000000000044';
select public.complete_onboarding('Ben', 1::smallint, 'UTC',
  '[{"weekday":1,"kind":"working","start_time":"17:00","end_time":"20:00"}]'::jsonb, null);
insert into onboarding_results select 'other student sees only their own profile and rules',
  (select count(*) = 1 from public.profiles) and (select count(*) = 1 from public.availability_rules), '';
reset role;
insert into onboarding_results select 'first student''s timetable is untouched',
  (select count(*) = 2 from public.availability_rules where user_id = '33333333-0000-4000-8000-000000000033'), '';

-- 6. Signed-out callers cannot run onboarding.
set role anon;
set test.uid = '';
select pg_temp.expect_error('signed-out caller cannot run onboarding',
  $q$select public.complete_onboarding('X', 1::smallint, 'UTC', null, null)$q$, '42');
reset role;

-- 7. The scheduler's reserved-time rule covers classes.
insert into onboarding_results select 'class is a valid availability kind',
  (select pg_get_constraintdef(oid) like '%class%' from pg_constraint where conname = 'availability_rules_kind_check'), '';

select (case when ok then 'PASS' else 'FAIL' end) || '  ' || name || case when ok or detail = '' then '' else '  [' || detail || ']' end from onboarding_results;

do $$ begin
  if exists (select 1 from onboarding_results where not ok) then
    raise exception 'Student onboarding database tests failed';
  end if;
end $$;
