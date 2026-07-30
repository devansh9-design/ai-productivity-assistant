-- Fix 1 (Critical): RLS policies only ever check `user_id = auth.uid()` on
-- the row being touched. They say nothing about the rows a foreign key on
-- that row *points at*. Without this migration, an authenticated user could
-- insert e.g. `projects.goal_id` pointing at another user's goal (if that
-- goal's uuid were ever discovered), creating an invalid cross-user
-- relationship RLS was never designed to catch.
--
-- This migration adds BEFORE INSERT OR UPDATE triggers that re-validate
-- every cross-table reference belongs to the same user_id as the row being
-- written, for:
--   projects.goal_id             -> goals.user_id
--   milestones.project_id        -> projects.user_id
--   tasks.goal_id                -> goals.user_id
--   tasks.project_id             -> projects.user_id
--   tasks.milestone_id           -> milestones.user_id
--   task_dependencies.task_id            -> tasks.user_id
--   task_dependencies.depends_on_task_id -> tasks.user_id
--   task_sessions.task_id        -> tasks.user_id
--
-- Fix 2 & 3 (High): going forward, every migration in this project follows
-- an idempotent pattern -- `create or replace function`, `drop trigger if
-- exists` before `create trigger`, and `drop policy if exists` before
-- `create policy` -- so a replayed, restored, or partially-applied
-- migration never fails because an object already exists. (Earlier
-- migrations that predate this convention are left as-is: rewriting an
-- already-applied migration's file content isn't picked up by Supabase's
-- migration history, so fixing them retroactively has to happen via a new
-- migration rather than an edit -- which is exactly what this file is.)

-- ---------------------------------------------------------------------
-- projects.goal_id -> goals.user_id
-- ---------------------------------------------------------------------
create or replace function public.check_project_goal_owner()
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
  return new;
end;
$$;

drop trigger if exists projects_check_goal_owner on public.projects;
create trigger projects_check_goal_owner
  before insert or update on public.projects
  for each row execute procedure public.check_project_goal_owner();

-- ---------------------------------------------------------------------
-- milestones.project_id -> projects.user_id
-- ---------------------------------------------------------------------
create or replace function public.check_milestone_project_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id = new.project_id and p.user_id = new.user_id
  ) then
    raise exception 'project_id % does not belong to user %', new.project_id, new.user_id
      using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists milestones_check_project_owner on public.milestones;
create trigger milestones_check_project_owner
  before insert or update on public.milestones
  for each row execute procedure public.check_milestone_project_owner();

-- ---------------------------------------------------------------------
-- tasks.goal_id / tasks.project_id / tasks.milestone_id
-- ---------------------------------------------------------------------
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

  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id = new.project_id and p.user_id = new.user_id
  ) then
    raise exception 'project_id % does not belong to user %', new.project_id, new.user_id
      using errcode = '23503';
  end if;

  if new.milestone_id is not null and not exists (
    select 1 from public.milestones m where m.id = new.milestone_id and m.user_id = new.user_id
  ) then
    raise exception 'milestone_id % does not belong to user %', new.milestone_id, new.user_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_check_references_owner on public.tasks;
create trigger tasks_check_references_owner
  before insert or update on public.tasks
  for each row execute procedure public.check_task_references_owner();

-- ---------------------------------------------------------------------
-- task_dependencies.task_id / depends_on_task_id -> tasks.user_id
-- ---------------------------------------------------------------------
create or replace function public.check_task_dependency_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id
  ) then
    raise exception 'task_id % does not belong to user %', new.task_id, new.user_id
      using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.tasks t where t.id = new.depends_on_task_id and t.user_id = new.user_id
  ) then
    raise exception 'depends_on_task_id % does not belong to user %', new.depends_on_task_id, new.user_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists task_dependencies_check_owner on public.task_dependencies;
create trigger task_dependencies_check_owner
  before insert or update on public.task_dependencies
  for each row execute procedure public.check_task_dependency_owner();

-- ---------------------------------------------------------------------
-- task_sessions.task_id -> tasks.user_id
-- ---------------------------------------------------------------------
create or replace function public.check_task_session_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id
  ) then
    raise exception 'task_id % does not belong to user %', new.task_id, new.user_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists task_sessions_check_owner on public.task_sessions;
create trigger task_sessions_check_owner
  before insert or update on public.task_sessions
  for each row execute procedure public.check_task_session_owner();
