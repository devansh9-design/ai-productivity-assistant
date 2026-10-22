-- Phase 2 Step 1 database behaviour tests: goals v2, roadmap, routines,
-- progress logs and daily feedback.
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
  ('11111111-0000-4000-8000-000000000011', 'g@test'),
  ('22222222-0000-4000-8000-000000000022', 'h@test')
on conflict (id) do nothing;

create temp table planner_results (name text, ok boolean, detail text);
grant all on planner_results to authenticated, anon;

-- Runs one statement that must fail with the given SQLSTATE class (first two characters).
create or replace function pg_temp.expect_error(test_name text, statement text, sqlstate_prefix text) returns void language plpgsql as $$
begin
  execute statement;
  insert into planner_results values (test_name, false, 'no error');
exception when others then
  insert into planner_results values (test_name, left(sqlstate, 2) = sqlstate_prefix, sqlstate || ' ' || sqlerrm);
end $$;

set role authenticated;
set test.uid = '11111111-0000-4000-8000-000000000011';

-- 1. A student builds the gym and DSA goals.
insert into public.goals (id, title, category, start_date, target_date, weekly_hours, level, plan_source) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'Put on muscle', 'fitness', '2026-10-19', '2026-12-18', 6, 'beginner', 'ai'),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', 'Placement-ready DSA', 'placement', '2026-10-19', '2026-12-31', 10, 'intermediate', 'manual');
insert into public.goal_metrics (id, goal_id, name, unit, aggregation, baseline_value, target_value) values
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'Body weight', 'kg', 'latest', 60, 65),
  ('bbbbbbbb-0000-4000-8000-0000000000b2', 'aaaaaaaa-0000-4000-8000-0000000000a2', 'Problems solved', 'problems', 'sum', 0, 300);
insert into public.goal_phases (goal_id, position, title, start_date, end_date) values
  ('aaaaaaaa-0000-4000-8000-0000000000a2', 1, 'Arrays and strings', '2026-10-19', '2026-11-08'),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', 2, 'Trees and graphs', '2026-11-09', '2026-11-29');
insert into public.weekly_targets (goal_id, week_start, title, goal_metric_id, target_value) values
  ('aaaaaaaa-0000-4000-8000-0000000000a2', '2026-10-19', '20 array problems', 'bbbbbbbb-0000-4000-8000-0000000000b2', 20);
insert into public.routines (id, goal_id, title, days_of_week, minutes, goal_metric_id, metric_amount) values
  ('cccccccc-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000a2', 'Two DSA problems', '{1,2,3,4,5}', 60, 'bbbbbbbb-0000-4000-8000-0000000000b2', 2);
insert into planner_results select 'student can build goals, metrics, phases, targets and routines',
  (select count(*) from public.goals where id in ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-0000000000a2')) = 2 and (select count(*) from public.goal_phases) = 2 and (select count(*) from public.routines) = 1, '';

-- 2. A routine creates at most one task per day.
insert into public.tasks (title, routine_id, occurrence_date) values ('Two DSA problems', 'cccccccc-0000-4000-8000-0000000000c1', '2026-10-20');
select pg_temp.expect_error('routine cannot create a second task for the same day',
  $q$insert into public.tasks (title, routine_id, occurrence_date) values ('Two DSA problems', 'cccccccc-0000-4000-8000-0000000000c1', '2026-10-20')$q$, '23');
select pg_temp.expect_error('routine task needs an occurrence date',
  $q$insert into public.tasks (title, routine_id) values ('Two DSA problems', 'cccccccc-0000-4000-8000-0000000000c1')$q$, '23');
insert into public.tasks (title, routine_id, occurrence_date) values ('Two DSA problems', 'cccccccc-0000-4000-8000-0000000000c1', '2026-10-21');
insert into planner_results select 'routine creates tasks for different days', (select count(*) = 2 from public.tasks where routine_id is not null), '';

-- 3. Re-saving a day's evening log replaces the value.
insert into public.progress_logs (goal_metric_id, log_date, value) values ('bbbbbbbb-0000-4000-8000-0000000000b1', '2026-10-20', 60.4);
insert into public.progress_logs (goal_metric_id, log_date, value) values ('bbbbbbbb-0000-4000-8000-0000000000b1', '2026-10-20', 60.6)
  on conflict (goal_metric_id, log_date) do update set value = excluded.value;
insert into planner_results select 'one progress value per metric per day', (select count(*) = 1 and max(value) = 60.6 from public.progress_logs), '';

-- 4. Validation.
select pg_temp.expect_error('goal target date cannot be before its start',
  $q$insert into public.goals (title, start_date, target_date) values ('Bad', '2026-12-01', '2026-11-01')$q$, '23');
select pg_temp.expect_error('goal category must be known',
  $q$insert into public.goals (title, category) values ('Bad', 'sleep')$q$, '23');
select pg_temp.expect_error('phase cannot end before it starts',
  $q$insert into public.goal_phases (goal_id, position, title, start_date, end_date) values ('aaaaaaaa-0000-4000-8000-0000000000a2', 3, 'Bad', '2026-12-10', '2026-12-01')$q$, '23');
select pg_temp.expect_error('two phases cannot share a position',
  $q$insert into public.goal_phases (goal_id, position, title, start_date, end_date) values ('aaaaaaaa-0000-4000-8000-0000000000a2', 1, 'Duplicate', '2026-12-01', '2026-12-10'); set constraints all immediate$q$, '23');
select pg_temp.expect_error('weekly target must start on a Monday',
  $q$insert into public.weekly_targets (goal_id, week_start, title) values ('aaaaaaaa-0000-4000-8000-0000000000a2', '2026-10-21', 'Bad')$q$, '23');
select pg_temp.expect_error('routine days must be 1-7',
  $q$insert into public.routines (title, days_of_week, minutes) values ('Bad', '{0,8}', 30)$q$, '23');
select pg_temp.expect_error('routine needs at least one day',
  $q$insert into public.routines (title, days_of_week, minutes) values ('Bad', '{}', 30)$q$, '23');
select pg_temp.expect_error('a routine metric must belong to the routine''s goal',
  $q$insert into public.routines (goal_id, title, days_of_week, minutes, goal_metric_id) values ('aaaaaaaa-0000-4000-8000-0000000000a2', 'Bad', '{1}', 30, 'bbbbbbbb-0000-4000-8000-0000000000b1')$q$, '23');
select pg_temp.expect_error('morning check-in time must fit in a day',
  $q$insert into public.checkins (checkin_date, type, available_minutes) values ('2026-10-20', 'morning', 2000)$q$, '23');
insert into public.checkins (checkin_date, type, available_minutes, energy_level) values ('2026-10-20', 'morning', 180, 'medium');
insert into public.daily_feedback (feedback_date, source, summary) values ('2026-10-20', 'ai', 'On track: 2 problems today.');
select pg_temp.expect_error('one feedback note per day',
  $q$insert into public.daily_feedback (feedback_date, source, summary) values ('2026-10-20', 'ai', 'Again')$q$, '23');
insert into planner_results select 'morning check-in and daily feedback save',
  (select count(*) = 1 from public.checkins where type = 'morning') and (select count(*) = 1 from public.daily_feedback), '';
update public.profiles set display_name = 'G', college_year = 3, timezone = 'Asia/Kolkata', onboarded_at = now()
  where id = '11111111-0000-4000-8000-000000000011';

-- 5. Another student sees none of it and cannot attach to it. (New accounts get
-- starter goals from the Day 2 signup trigger, so only foreign rows are counted.)
set test.uid = '22222222-0000-4000-8000-000000000022';
insert into planner_results select 'other student sees no goals, metrics, phases, targets, routines, logs or feedback',
  (select count(*) from public.goals where user_id <> '22222222-0000-4000-8000-000000000022') + (select count(*) from public.goal_metrics) + (select count(*) from public.goal_phases)
  + (select count(*) from public.weekly_targets) + (select count(*) from public.routines) + (select count(*) from public.progress_logs)
  + (select count(*) from public.daily_feedback) = 0, '';
select pg_temp.expect_error('cannot add a metric to another student''s goal',
  $q$insert into public.goal_metrics (goal_id, name) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'Sneaky')$q$, '23');
select pg_temp.expect_error('cannot add a phase to another student''s goal',
  $q$insert into public.goal_phases (goal_id, position, title, start_date, end_date) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 9, 'Sneaky', '2026-10-20', '2026-10-21')$q$, '23');
select pg_temp.expect_error('cannot log progress on another student''s metric',
  $q$insert into public.progress_logs (goal_metric_id, log_date, value) values ('bbbbbbbb-0000-4000-8000-0000000000b1', '2026-10-21', 99)$q$, '23');
select pg_temp.expect_error('cannot create a task from another student''s routine',
  $q$insert into public.tasks (title, routine_id, occurrence_date) values ('Sneaky', 'cccccccc-0000-4000-8000-0000000000c1', '2026-10-22')$q$, '23');
select pg_temp.expect_error('cannot write rows as another student',
  $q$insert into public.routines (user_id, title, days_of_week, minutes) values ('11111111-0000-4000-8000-000000000011', 'Sneaky', '{1}', 30)$q$, '42');
do $$ declare changed bigint; begin
  update public.routines set title = 'Hijacked' where id = 'cccccccc-0000-4000-8000-0000000000c1';
  get diagnostics changed = row_count;
  insert into planner_results values ('cannot change another student''s routine', changed = 0, changed || ' rows changed');
end $$;

-- 6. Signed-out callers see nothing.
reset role;
set role anon;
set test.uid = '';
do $$ declare visible bigint; begin
  select count(*) into visible from public.routines;
  insert into planner_results values ('anon sees no routines', visible = 0, visible || ' rows visible');
exception when insufficient_privilege then insert into planner_results values ('anon sees no routines', true, sqlerrm); end $$;
reset role;

-- 7. Deleting a goal removes its roadmap; its routine tasks stay as history.
set role authenticated;
set test.uid = '11111111-0000-4000-8000-000000000011';
delete from public.goals where id = 'aaaaaaaa-0000-4000-8000-0000000000a2';
insert into planner_results select 'deleting a goal removes its metrics, phases, targets and routines',
  (select count(*) from public.goal_phases) + (select count(*) from public.weekly_targets) + (select count(*) from public.routines)
  + (select count(*) from public.goal_metrics where goal_id = 'aaaaaaaa-0000-4000-8000-0000000000a2') = 0, '';
insert into planner_results select 'routine tasks are kept, detached from the deleted routine',
  (select count(*) = 2 from public.tasks where occurrence_date is not null and routine_id is null), '';
reset role;

-- 8. Grants: no API role can call the new trigger functions.
insert into planner_results select 'no API role can call a trigger function',
  (select bool_and(not has_function_privilege(r, p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon', 'authenticated']) r
   where n.nspname = 'public' and p.prorettype = 'trigger'::regtype), '';

select (case when ok then 'PASS' else 'FAIL' end) || '  ' || name || case when ok or detail = '' then '' else '  [' || detail || ']' end from planner_results;

do $$ begin
  if exists (select 1 from planner_results where not ok) then
    raise exception 'Student planner database tests failed';
  end if;
end $$;
