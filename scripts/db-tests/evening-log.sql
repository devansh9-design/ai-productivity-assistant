-- Phase 2 Step 7 database behaviour tests: evening_log_items and save_evening_log.
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
  ('77777777-0000-4000-8000-000000000077', 'e@test'),
  ('66666666-0000-4000-8000-000000000066', 'f@test')
on conflict (id) do nothing;

create temp table log_results (name text, ok boolean, detail text);
grant all on log_results to authenticated, anon;

create or replace function pg_temp.expect_error(test_name text, statement text, sqlstate_prefix text) returns void language plpgsql as $$
begin
  execute statement;
  insert into log_results values (test_name, false, 'no error');
exception when others then
  insert into log_results values (test_name, left(sqlstate, 2) = sqlstate_prefix, sqlstate || ' ' || sqlerrm);
end $$;

set role authenticated;
set test.uid = '77777777-0000-4000-8000-000000000077';

insert into public.goals (id, title, category) values ('cccc0000-0000-4000-8000-000000000001', 'DSA', 'placement');
insert into public.goal_metrics (id, goal_id, name, unit, aggregation) values
  ('dddd0000-0000-4000-8000-000000000001', 'cccc0000-0000-4000-8000-000000000001', 'Problems solved', 'problems', 'sum'),
  ('dddd0000-0000-4000-8000-000000000002', 'cccc0000-0000-4000-8000-000000000001', 'Hours studied', 'h', 'sum');
insert into public.routines (id, goal_id, title, days_of_week, minutes, start_date) values
  ('eeee0000-0000-4000-8000-000000000001', 'cccc0000-0000-4000-8000-000000000001', 'Two problems', '{1,2,3,4,5,6,7}', 40, '2026-10-01');
insert into public.tasks (id, title, status, due_date) values
  ('ffff0000-0000-4000-8000-000000000001', 'Lab report', 'todo', '2026-10-22'),
  ('ffff0000-0000-4000-8000-000000000002', 'Read chapter', 'in_progress', '2026-10-22'),
  ('ffff0000-0000-4000-8000-000000000003', 'Mock test', 'todo', '2026-10-22');
insert into public.tasks (id, title, status, routine_id, occurrence_date, due_date) values
  ('ffff0000-0000-4000-8000-000000000004', 'Two problems', 'todo', 'eeee0000-0000-4000-8000-000000000001', '2026-10-22', '2026-10-22');
insert into public.task_sessions (task_id, started_at) values ('ffff0000-0000-4000-8000-000000000002', now() - interval '30 minutes');

-- 1. One save closes the day.
select public.save_evening_log('2026-10-22',
  '[{"task_id": "ffff0000-0000-4000-8000-000000000001", "outcome": "done"},
    {"task_id": "ffff0000-0000-4000-8000-000000000002", "outcome": "skipped", "reason": "Ran out of time"},
    {"task_id": "ffff0000-0000-4000-8000-000000000003", "outcome": "partial", "reason": "Did half"},
    {"task_id": "ffff0000-0000-4000-8000-000000000004", "outcome": "partial"}]',
  '[{"goal_metric_id": "dddd0000-0000-4000-8000-000000000001", "value": 3},
    {"goal_metric_id": "dddd0000-0000-4000-8000-000000000002", "value": 1.5}]',
  '{"mood": 4, "lesson": "Start earlier", "note": "Good day"}');

insert into log_results select 'done completes the task',
  (select status = 'completed' and status_reason is null and completed_at is not null from public.tasks where id = 'ffff0000-0000-4000-8000-000000000001'), '';
insert into log_results select 'skipped keeps the reason and stops the running timer',
  (select status = 'skipped' and status_reason = 'Ran out of time' from public.tasks where id = 'ffff0000-0000-4000-8000-000000000002')
  and (select bool_and(ended_at is not null) from public.task_sessions where task_id = 'ffff0000-0000-4000-8000-000000000002'), '';
insert into log_results select 'a partly done one-off task stays open',
  (select status = 'todo' and status_reason = 'Partly done: Did half' from public.tasks where id = 'ffff0000-0000-4000-8000-000000000003'), '';
insert into log_results select 'a partly done routine session counts as held',
  (select status = 'completed' and status_reason = 'Partly done.' from public.tasks where id = 'ffff0000-0000-4000-8000-000000000004'), '';
insert into log_results select 'each outcome is kept per task and day',
  (select count(*) = 4 from public.evening_log_items where log_date = '2026-10-22')
  and (select outcome = 'partial' and reason is null from public.evening_log_items where task_id = 'ffff0000-0000-4000-8000-000000000004'), '';
insert into log_results select 'metric numbers are saved for the day',
  (select value = 3 from public.progress_logs where goal_metric_id = 'dddd0000-0000-4000-8000-000000000001' and log_date = '2026-10-22')
  and (select value = 1.5 from public.progress_logs where goal_metric_id = 'dddd0000-0000-4000-8000-000000000002' and log_date = '2026-10-22'), '';
insert into log_results select 'mood, lesson and note are saved',
  (select mood = 4 and lesson = 'Start earlier' from public.checkins where checkin_date = '2026-10-22' and type = 'evening')
  and (select reflection = 'Good day' from public.journal_entries where entry_date = '2026-10-22'), '';

-- 2. Saving again edits the same rows; a cleared number or note is removed.
select public.save_evening_log('2026-10-22',
  '[{"task_id": "ffff0000-0000-4000-8000-000000000003", "outcome": "done"}]',
  '[{"goal_metric_id": "dddd0000-0000-4000-8000-000000000001", "value": 5},
    {"goal_metric_id": "dddd0000-0000-4000-8000-000000000002", "value": null}]',
  '{"mood": null, "lesson": "", "note": ""}');
insert into log_results select 'saving again edits instead of duplicating',
  (select count(*) = 4 from public.evening_log_items where log_date = '2026-10-22')
  and (select outcome = 'done' from public.evening_log_items where task_id = 'ffff0000-0000-4000-8000-000000000003')
  and (select status = 'completed' and status_reason is null from public.tasks where id = 'ffff0000-0000-4000-8000-000000000003')
  and (select count(*) = 1 and min(value) = 5 from public.progress_logs where goal_metric_id = 'dddd0000-0000-4000-8000-000000000001'), '';
insert into log_results select 'a cleared number and note are removed, untouched tasks stay',
  (select count(*) = 0 from public.progress_logs where goal_metric_id = 'dddd0000-0000-4000-8000-000000000002')
  and (select count(*) = 0 from public.journal_entries where entry_date = '2026-10-22')
  and (select mood is null and lesson is null from public.checkins where checkin_date = '2026-10-22' and type = 'evening')
  and (select status = 'skipped' from public.tasks where id = 'ffff0000-0000-4000-8000-000000000002'), '';

-- 3. Bad input changes nothing.
select pg_temp.expect_error('skipping without a reason is refused',
  $q$select public.save_evening_log('2026-10-23', '[{"task_id": "ffff0000-0000-4000-8000-000000000001", "outcome": "skipped", "reason": "  "}]', '[]', '{}')$q$, '22');
select pg_temp.expect_error('an unknown outcome is refused',
  $q$select public.save_evening_log('2026-10-23', '[{"task_id": "ffff0000-0000-4000-8000-000000000001", "outcome": "maybe"}]', '[]', '{}')$q$, '23');
insert into log_results select 'a refused save leaves nothing behind',
  (select count(*) = 0 from public.evening_log_items where log_date = '2026-10-23')
  and (select status = 'completed' from public.tasks where id = 'ffff0000-0000-4000-8000-000000000001'), '';

-- 4. Another student can't read, log against or change these rows.
set test.uid = '66666666-0000-4000-8000-000000000066';
insert into log_results select 'another student sees no log items',
  (select count(*) = 0 from public.evening_log_items), '';
select pg_temp.expect_error('another student cannot log someone else''s task',
  $q$select public.save_evening_log('2026-10-22', '[{"task_id": "ffff0000-0000-4000-8000-000000000001", "outcome": "skipped", "reason": "x"}]', '[]', '{}')$q$, 'P0');
select pg_temp.expect_error('another student cannot log someone else''s metric',
  $q$select public.save_evening_log('2026-10-22', '[]', '[{"goal_metric_id": "dddd0000-0000-4000-8000-000000000001", "value": 99}]', '{}')$q$, '23');
select pg_temp.expect_error('a log item cannot point at another student''s task',
  $q$insert into public.evening_log_items (task_id, log_date, outcome) values ('ffff0000-0000-4000-8000-000000000001', '2026-10-24', 'done')$q$, '23');
reset role;
insert into log_results select 'the first student''s data is unchanged by the other student',
  (select status = 'completed' from public.tasks where id = 'ffff0000-0000-4000-8000-000000000001')
  and (select value = 5 from public.progress_logs where goal_metric_id = 'dddd0000-0000-4000-8000-000000000001' and log_date = '2026-10-22'), '';

-- 5. Signed-out callers cannot run it.
set role anon;
set test.uid = '';
select pg_temp.expect_error('signed-out caller cannot save a log',
  $q$select public.save_evening_log('2026-10-22', '[]', '[]', '{}')$q$, '42');
reset role;

select (case when ok then 'PASS' else 'FAIL' end) || '  ' || name || case when ok or detail = '' then '' else '  [' || detail || ']' end from log_results;

do $$ begin
  if exists (select 1 from log_results where not ok) then
    raise exception 'Evening log database tests failed';
  end if;
end $$;
