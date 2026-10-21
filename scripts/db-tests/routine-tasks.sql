-- Phase 2 Step 5 database behaviour tests: materialize_routine_tasks.
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
  ('88888888-0000-4000-8000-000000000088', 't@test'),
  ('99999999-0000-4000-8000-000000000099', 'u@test')
on conflict (id) do nothing;

create temp table routine_results (name text, ok boolean, detail text);
grant all on routine_results to authenticated, anon;
create temp table created (day date, n integer);
grant all on created to authenticated, anon;

create or replace function pg_temp.expect_error(test_name text, statement text, sqlstate_prefix text) returns void language plpgsql as $$
begin
  execute statement;
  insert into routine_results values (test_name, false, 'no error');
exception when others then
  insert into routine_results values (test_name, left(sqlstate, 2) = sqlstate_prefix, sqlstate || ' ' || sqlerrm);
end $$;

set role authenticated;
set test.uid = '88888888-0000-4000-8000-000000000088';

insert into public.goals (id, title, category) values
  ('aaaa0000-0000-4000-8000-000000000001', 'Build muscle', 'fitness'),
  ('aaaa0000-0000-4000-8000-000000000002', 'Old goal', 'skill');
update public.goals set status = 'archived' where id = 'aaaa0000-0000-4000-8000-000000000002';
-- Gym Mon/Wed/Fri from 19 Oct to 31 Dec; paused cardio; a routine of an archived goal; a free-standing reading habit every day from 22 Oct.
insert into public.routines (id, goal_id, title, days_of_week, minutes, priority, energy_level, start_date, end_date, active) values
  ('bbbb0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001', 'Gym', '{1,3,5}', 75, 'high', 'high', '2026-10-19', '2026-12-31', true),
  ('bbbb0000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000001', 'Cardio', '{1,3,5}', 30, 'low', null, '2026-10-19', null, false),
  ('bbbb0000-0000-4000-8000-000000000003', 'aaaa0000-0000-4000-8000-000000000002', 'Old habit', '{1,2,3,4,5,6,7}', 20, 'low', null, '2026-10-01', null, true),
  ('bbbb0000-0000-4000-8000-000000000004', null, 'Read', '{1,2,3,4,5,6,7}', 20, 'medium', null, '2026-10-22', null, true);

-- 1. Monday 19 Oct: only the gym (cardio paused, old goal archived, reading not started yet).
-- (Each call runs in its own statement: a check in the same statement could not see the rows it inserts.)
insert into created select '2026-10-19', public.materialize_routine_tasks('2026-10-19');
insert into routine_results select 'creates tasks only for active routines on their day',
  (select n = 1 from created where day = '2026-10-19')
  and (select string_agg(title, ',') = 'Gym' from public.tasks where occurrence_date = '2026-10-19'), '';
insert into routine_results select 'task copies the routine''s details',
  (select goal_id = 'aaaa0000-0000-4000-8000-000000000001' and estimated_minutes = 75 and priority = 'high' and energy_level = 'high'
     and due_date = '2026-10-19' and status = 'todo' and category = 'fitness' and description like 'From your routine for Build muscle%'
   from public.tasks where routine_id = 'bbbb0000-0000-4000-8000-000000000001'), '';

-- 2. Running again (reload, second tab) never duplicates.
insert into routine_results select 'running again creates nothing new',
  public.materialize_routine_tasks('2026-10-19') = 0 and public.materialize_routine_tasks('2026-10-19') = 0
  and (select count(*) = 1 from public.tasks where occurrence_date = '2026-10-19'), '';

-- 3. Tuesday: no gym. Thursday 22 Oct: reading starts, still no gym.
insert into routine_results select 'nothing on a day the routine skips',
  public.materialize_routine_tasks('2026-10-20') = 0, '';
insert into created select '2026-10-22', public.materialize_routine_tasks('2026-10-22');
insert into routine_results select 'a routine starts on its start date',
  (select n = 1 from created where day = '2026-10-22') and (select title = 'Read' from public.tasks where occurrence_date = '2026-10-22'), '';

-- 4. Past occurrences that were never done are marked missed; done or moved ones are left alone.
insert into routine_results select 'monday''s unfinished gym is marked as missed on a later day',
  (select status = 'skipped' and status_reason like 'Missed:%' from public.tasks where occurrence_date = '2026-10-19'), '';
update public.tasks set status = 'completed' where occurrence_date = '2026-10-22';
select public.materialize_routine_tasks('2026-10-23');
update public.tasks set due_date = '2026-10-25' where occurrence_date = '2026-10-23';
select public.materialize_routine_tasks('2026-10-24');
insert into routine_results select 'completed occurrences stay completed',
  (select status = 'completed' from public.tasks where occurrence_date = '2026-10-22'), '';
insert into routine_results select 'an occurrence moved to a later day is not marked missed',
  (select bool_and(status = 'todo') from public.tasks where occurrence_date = '2026-10-23'), '';

-- 5. A routine past its end date creates nothing; editing it doesn't touch tasks already created.
insert into created select '2027-01-04', public.materialize_routine_tasks('2027-01-04');
insert into routine_results select 'nothing after the routine ends',
  (select n = 1 from created where day = '2027-01-04') and (select count(*) = 0 from public.tasks where occurrence_date = '2027-01-04' and title = 'Gym'), '';
update public.routines set minutes = 90 where id = 'bbbb0000-0000-4000-8000-000000000001';
insert into routine_results select 'editing a routine leaves existing tasks as they were',
  (select bool_and(estimated_minutes = 75) from public.tasks where routine_id = 'bbbb0000-0000-4000-8000-000000000001'), '';

-- 6. Another student's call only touches their own routines.
set test.uid = '99999999-0000-4000-8000-000000000099';
insert into created select '2026-10-26', public.materialize_routine_tasks('2026-10-26');
insert into routine_results select 'another student gets nothing from these routines',
  (select n = 0 from created where day = '2026-10-26') and (select count(*) = 0 from public.tasks), '';
reset role;
insert into routine_results select 'the first student''s tasks are untouched by the other student',
  (select count(*) = 0 from public.tasks where occurrence_date = '2026-10-26'), '';

-- 7. Signed-out callers cannot run it.
set role anon;
set test.uid = '';
select pg_temp.expect_error('signed-out caller cannot create routine tasks',
  $q$select public.materialize_routine_tasks('2026-10-19')$q$, '42');
reset role;

select (case when ok then 'PASS' else 'FAIL' end) || '  ' || name || case when ok or detail = '' then '' else '  [' || detail || ']' end from routine_results;

do $$ begin
  if exists (select 1 from routine_results where not ok) then
    raise exception 'Routine task database tests failed';
  end if;
end $$;
