-- Phase 2 Step 4 database behaviour tests: save_goal_roadmap.
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
  ('55555555-0000-4000-8000-000000000055', 'r@test'),
  ('66666666-0000-4000-8000-000000000066', 's@test')
on conflict (id) do nothing;

create temp table roadmap_results (name text, ok boolean, detail text);
grant all on roadmap_results to authenticated, anon;

create or replace function pg_temp.expect_error(test_name text, statement text, sqlstate_prefix text) returns void language plpgsql as $$
begin
  execute statement;
  insert into roadmap_results values (test_name, false, 'no error');
exception when others then
  insert into roadmap_results values (test_name, left(sqlstate, 2) = sqlstate_prefix, sqlstate || ' ' || sqlerrm);
end $$;

set role authenticated;
set test.uid = '55555555-0000-4000-8000-000000000055';
insert into public.goals (id, title, category) values ('77777777-0000-4000-8000-000000000077', 'DSA for placements', 'placement');
insert into public.goal_metrics (goal_id, name, unit) values ('77777777-0000-4000-8000-000000000077', 'Problems solved', 'problems');

-- 1. A full roadmap saves in one call, reusing the metric the goal already tracks.
select public.save_goal_roadmap('77777777-0000-4000-8000-000000000077',
  '{"start_date":"2026-10-19","target_date":"2026-12-31","weekly_hours":8,"level":"intermediate"}',
  '[{"name":"problems solved","unit":"problems","aggregation":"sum","baseline_value":0,"target_value":300},
    {"name":"Mock score","unit":"/10","aggregation":"latest","baseline_value":4,"target_value":8}]',
  '[{"title":"Trees","focus":"BFS/DFS","start_date":"2026-11-09","end_date":"2026-11-29","target_note":"180 problems"},
    {"title":"Arrays","focus":null,"start_date":"2026-10-19","end_date":"2026-11-08","target_note":"100 problems"}]',
  '[{"week_start":"2026-10-19","title":"20 array problems","metric_name":"Problems Solved","target_value":20}]',
  '[{"title":"2 DSA problems","days_of_week":[1,2,3,4,5],"minutes":60,"preferred_start":"18:00","preferred_end":null,"priority":"high","metric_name":"problems solved","metric_amount":2,"start_date":"2026-10-21","end_date":"2026-12-31"}]',
  false);
insert into roadmap_results select 'goal updated with dates, hours, level and marked as AI-planned',
  (select start_date = '2026-10-19' and target_date = '2026-12-31' and weekly_hours = 8 and level = 'intermediate' and plan_source = 'ai' from public.goals where id = '77777777-0000-4000-8000-000000000077'), '';
insert into roadmap_results select 'existing metric reused, new one added',
  (select count(*) = 2 from public.goal_metrics) and (select count(*) = 1 from public.goal_metrics where lower(name) = 'problems solved'), '';
insert into roadmap_results select 'phases numbered in date order',
  (select string_agg(title, ',' order by position) = 'Arrays,Trees' from public.goal_phases), '';
insert into roadmap_results select 'target and routine linked to the metric by name',
  (select goal_metric_id is not null from public.weekly_targets) and (select goal_metric_id is not null and days_of_week = '{1,2,3,4,5}' from public.routines), '';

-- 2. Saving again without replace adds after the existing phases.
select public.save_goal_roadmap('77777777-0000-4000-8000-000000000077',
  '{"start_date":"2026-10-19","target_date":"2026-12-31","weekly_hours":8,"level":"intermediate"}',
  null, '[{"title":"DP","start_date":"2026-11-30","end_date":"2026-12-31"}]', null, null, false);
insert into roadmap_results select 'adding keeps earlier phases and numbers new ones after them',
  (select string_agg(title || position, ',' order by position) = 'Arrays1,Trees2,DP3' from public.goal_phases), '';

-- 3. Replace swaps the roadmap but keeps metrics and their history.
insert into public.progress_logs (goal_metric_id, log_date, value)
  select id, '2026-10-21', 2 from public.goal_metrics where name = 'Problems solved';
select public.save_goal_roadmap('77777777-0000-4000-8000-000000000077',
  '{"start_date":"2026-10-19","target_date":"2026-12-31","weekly_hours":6,"level":"intermediate"}',
  '[]', '[{"title":"Revised","start_date":"2026-10-19","end_date":"2026-12-31"}]', '[]', '[]', true);
insert into roadmap_results select 'replace removes old phases, targets and routines',
  (select count(*) = 1 from public.goal_phases) and (select count(*) = 0 from public.weekly_targets) and (select count(*) = 0 from public.routines), '';
insert into roadmap_results select 'replace keeps metrics and logged progress',
  (select count(*) = 2 from public.goal_metrics) and (select count(*) = 1 from public.progress_logs), '';

-- 4. A bad row rolls the whole save back.
select pg_temp.expect_error('a broken routine rejects the whole save',
  $q$select public.save_goal_roadmap('77777777-0000-4000-8000-000000000077', '{"start_date":"2026-10-19","target_date":"2026-12-31","weekly_hours":6}',
     null, '[{"title":"Should not stay","start_date":"2026-10-19","end_date":"2026-10-20"}]', null,
     '[{"title":"Bad","days_of_week":[9],"minutes":30,"start_date":"2026-10-21"}]', false)$q$, '23');
insert into roadmap_results select 'nothing from the rejected save remains',
  (select count(*) = 1 from public.goal_phases) and (select weekly_hours = 6 from public.goals where id = '77777777-0000-4000-8000-000000000077'), '';
select pg_temp.expect_error('sections must be lists',
  $q$select public.save_goal_roadmap('77777777-0000-4000-8000-000000000077', '{}', '{"name":"x"}', null, null, null, false)$q$, '22');

-- 5. Another student cannot save into this goal.
set test.uid = '66666666-0000-4000-8000-000000000066';
select pg_temp.expect_error('another student cannot save a roadmap to this goal',
  $q$select public.save_goal_roadmap('77777777-0000-4000-8000-000000000077', '{}', null, '[{"title":"Sneaky","start_date":"2026-10-19","end_date":"2026-10-20"}]', null, null, true)$q$, 'P0');
reset role;
insert into roadmap_results select 'the first student''s roadmap is unchanged',
  (select count(*) = 1 from public.goal_phases where goal_id = '77777777-0000-4000-8000-000000000077'), '';

-- 6. Signed-out callers cannot call it.
set role anon;
set test.uid = '';
select pg_temp.expect_error('signed-out caller cannot save a roadmap',
  $q$select public.save_goal_roadmap('77777777-0000-4000-8000-000000000077', '{}', null, null, null, null, false)$q$, '42');
reset role;

select (case when ok then 'PASS' else 'FAIL' end) || '  ' || name || case when ok or detail = '' then '' else '  [' || detail || ']' end from roadmap_results;

do $$ begin
  if exists (select 1 from roadmap_results where not ok) then
    raise exception 'Student roadmap database tests failed';
  end if;
end $$;
