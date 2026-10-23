-- Cleanup after Phase 2: removes what the app no longer uses.
--
-- 1. Projects and milestones. Their pages were removed in Step 11, and on
--    2026-10-22 the owner chose not to migrate their rows (only Phase 1 test
--    data). This deletes those rows for good.
-- 2. claim_ai_request(int, int), replaced in Step 12 by the three-argument
--    version with the shared daily cap.
--
-- Apply only after the code that stops exporting these tables is deployed.

-- Tasks keep checking that their goal and routine belong to the same user.
create or replace function public.check_task_references_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.goal_id is not null and not exists (
    select 1 from public.goals g where g.id = new.goal_id and g.user_id = new.user_id
  ) then
    raise exception 'goal_id % does not belong to user %', new.goal_id, new.user_id
      using errcode = '23503';
  end if;

  if new.routine_id is not null and not exists (
    select 1 from public.routines r where r.id = new.routine_id and r.user_id = new.user_id
  ) then
    raise exception 'routine_id % does not belong to user %', new.routine_id, new.user_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

alter table public.tasks
  drop column if exists milestone_id,
  drop column if exists project_id;

-- Dropping the tables also drops their policies, indexes and triggers.
drop table if exists public.milestones;
drop table if exists public.projects;
drop function if exists public.check_milestone_project_owner();
drop function if exists public.check_project_goal_owner();

drop function if exists public.claim_ai_request(integer, integer);
