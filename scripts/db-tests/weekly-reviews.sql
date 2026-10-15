-- Day 11 database behaviour tests for weekly reviews and weekly plans.
--
-- Runs in CI after every migration has been applied to a throwaway Postgres
-- (see .github/workflows/migrations-clean-db.yml). It replaces the CI stub's
-- auth.uid() so it can act as two different signed-in users; never run it
-- against a real Supabase project. Fails if any check fails.
-- Test harness only: let auth.uid() read a session setting.
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
insert into auth.users (id, email) values ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test'), ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test');

create temp table results (name text, ok boolean, detail text);
grant all on results to authenticated, anon;

set role authenticated;
set test.uid = 'aaaaaaaa-0000-4000-8000-000000000001';
insert into public.tasks (id, user_id, title) values
  ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Task one'),
  ('11111111-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Task two');

-- 1. Valid save: one existing priority, one typed title, one shortlist task.
select id from public.save_weekly_plan('2026-10-19', '2026-10-05',
  '[{"task_id":"11111111-0000-4000-8000-000000000001"},{"new_title":"  Brand new priority  "}]',
  '[{"task_id":"11111111-0000-4000-8000-000000000002"}]') \gset
insert into results select 'valid save creates 2 priorities + 1 shortlist',
  (select count(*) filter (where kind='priority') = 2 and count(*) filter (where kind='shortlist') = 1 from public.weekly_plan_items), '';
insert into results select 'typed title became a trimmed task',
  exists (select 1 from public.tasks where title = 'Brand new priority'), '';

-- 2. Failures roll back everything, including tasks created from typed titles.
do $$ begin
  perform public.save_weekly_plan('2026-10-19', null,
    '[{"new_title":"Should roll back"},{"task_id":"11111111-0000-4000-8000-000000000001"}]',
    '[{"task_id":"11111111-0000-4000-8000-000000000001"}]');
  insert into results values ('duplicate task rejected', false, 'no error');
exception when unique_violation then insert into results values ('duplicate task rejected', true, sqlerrm);
end $$;
insert into results select 'failed save created no task', not exists (select 1 from public.tasks where title = 'Should roll back'), '';
insert into results select 'failed save kept the earlier items', (select count(*) = 3 from public.weekly_plan_items), '';

do $$ begin
  perform public.save_weekly_plan('2026-10-19', null, '[{"new_title":"a"},{"new_title":"b"},{"new_title":"c"},{"new_title":"d"}]', '[]');
  insert into results values ('4 priorities rejected', false, 'no error');
exception when others then insert into results values ('4 priorities rejected', true, sqlerrm); end $$;
do $$ begin
  perform public.save_weekly_plan('2026-10-19', null, '[]', (select jsonb_agg(jsonb_build_object('task_id', gen_random_uuid())) from generate_series(1, 8)));
  insert into results values ('8 shortlist items rejected', false, 'no error');
exception when others then insert into results values ('8 shortlist items rejected', true, sqlerrm); end $$;
do $$ begin
  perform public.save_weekly_plan('2026-10-20', null, '[]', '[]');
  insert into results values ('non-Monday week rejected', false, 'no error');
exception when check_violation then insert into results values ('non-Monday week rejected', true, sqlerrm); end $$;
do $$ begin
  perform public.save_weekly_plan('2026-10-26', null, '[{"new_title":"   "}]', '[]');
  insert into results values ('blank typed title rejected', false, 'no error');
exception when others then insert into results values ('blank typed title rejected', true, sqlerrm); end $$;
insert into results select 'blank-title failure left no plan for that week', not exists (select 1 from public.weekly_plans where planning_week_start = '2026-10-26'), '';

-- 3. Summary save with a highlight; deleting the task removes the highlight only.
select id from public.save_weekly_review_summary('2026-10-05', 'ai', 'A steady week', 'Keep going',
  '[{"metric":"completed_tasks","note":"Good progress"}]', null,
  '[{"task_id":"11111111-0000-4000-8000-000000000002","note":"Finished early"}]') \gset
insert into results select 'summary saved with 1 highlight', (select count(*) = 1 from public.weekly_review_highlights), '';
delete from public.tasks where id = '11111111-0000-4000-8000-000000000002';
insert into results select 'deleting the task removed its highlight, review kept',
  (select count(*) = 0 from public.weekly_review_highlights) and exists (select 1 from public.weekly_reviews), '';

-- 4. Another user cannot see or reference user A's rows.
set test.uid = 'bbbbbbbb-0000-4000-8000-000000000002';
insert into results select 'user B sees none of A''s plans, items, or reviews',
  (select count(*) from public.weekly_plans) + (select count(*) from public.weekly_plan_items) + (select count(*) from public.weekly_reviews) = 0, '';
do $$ begin
  perform public.save_weekly_plan('2026-10-19', null, '[{"task_id":"11111111-0000-4000-8000-000000000001"}]', '[]');
  insert into results values ('user B cannot use A''s task', false, 'no error');
exception when foreign_key_violation then insert into results values ('user B cannot use A''s task', true, sqlerrm); end $$;
insert into results select 'user B''s failed save left no plan', not exists (select 1 from public.weekly_plans), '';

-- 5. Signed-out callers cannot run the functions at all.
reset role;
set role anon;
do $$ begin
  perform public.save_weekly_plan('2026-10-19', null, '[]', '[]');
  insert into results values ('anon cannot execute save_weekly_plan', false, 'no error');
exception when insufficient_privilege then insert into results values ('anon cannot execute save_weekly_plan', true, sqlerrm); end $$;
reset role;

select (case when ok then 'PASS' else 'FAIL' end) || '  ' || name || case when ok or detail = '' then '' else '  [' || detail || ']' end from results;

do $$ begin
  if exists (select 1 from results where not ok) then
    raise exception 'Weekly review database tests failed';
  end if;
end $$;
