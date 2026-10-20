-- Phase 2, Step 1: data model for the student planner (student-planner-plan.md, section 3).
--
-- Long-term goals get dates, a level, weekly hours and measurable metrics.
-- A goal's roadmap is its phases and weekly targets; routines are its
-- recurring work and create one task per day they fall on. Evening logs
-- record metric values; the AI's daily feedback is kept per day. Old projects
-- and milestones are left untouched here; Step 11 moves them into phases.
--
-- Same patterns as earlier migrations: user_id defaults to auth.uid(),
-- owner-only RLS, grants to authenticated, updated_at triggers, and triggers
-- that stop a row pointing at another user's rows.

-- ---------------------------------------------------------------------------
-- Existing tables: profiles, goals, tasks, checkins
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  add column if not exists college_year smallint check (college_year is null or college_year between 1 and 6),
  add column if not exists timezone text check (timezone is null or char_length(timezone) between 1 and 64),
  add column if not exists onboarded_at timestamptz;

alter table public.goals
  add column if not exists category text not null default 'other'
    check (category in ('fitness', 'academics', 'placement', 'skill', 'other')),
  add column if not exists start_date date,
  add column if not exists target_date date,
  add column if not exists weekly_hours numeric(4, 1) check (weekly_hours is null or (weekly_hours > 0 and weekly_hours <= 112)),
  add column if not exists level text check (level is null or level in ('beginner', 'intermediate', 'advanced')),
  add column if not exists plan_source text check (plan_source is null or plan_source in ('ai', 'manual'));

do $$ begin
  alter table public.goals add constraint goals_target_after_start
    check (start_date is null or target_date is null or target_date >= start_date);
exception when duplicate_object then null; end $$;

alter table public.checkins
  add column if not exists available_minutes integer check (available_minutes is null or available_minutes between 0 and 1440),
  add column if not exists notes text check (notes is null or char_length(notes) <= 1000);

-- ---------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------

-- What progress means for a goal, e.g. "Body weight, kg, 60 -> 65, latest"
-- or "DSA problems solved, 0 -> 300, sum". "latest" uses the most recent
-- logged value; "sum" adds up every logged value.
create table if not exists public.goal_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  unit text check (unit is null or char_length(unit) between 1 and 20),
  aggregation text not null default 'sum' check (aggregation in ('sum', 'latest')),
  baseline_value numeric,
  target_value numeric,
  position smallint not null default 1 check (position between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_metrics_unique_name unique (goal_id, name)
);

-- The roadmap: ordered phases with dates and an end-of-phase target.
-- Positions are deferrable so phases can be reordered in one transaction.
create table if not exists public.goal_phases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  position smallint not null check (position between 1 and 52),
  title text not null check (char_length(title) between 1 and 200),
  focus text check (focus is null or char_length(focus) <= 1000),
  start_date date not null,
  end_date date not null,
  target_note text check (target_note is null or char_length(target_note) <= 500),
  status text not null default 'upcoming' check (status in ('upcoming', 'active', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_phases_end_after_start check (end_date >= start_date),
  constraint goal_phases_unique_position unique (goal_id, position) deferrable initially deferred
);

-- What one week should achieve for a goal, optionally as a metric amount.
create table if not exists public.weekly_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  title text not null check (char_length(title) between 1 and 200),
  goal_metric_id uuid references public.goal_metrics(id) on delete set null,
  target_value numeric check (target_value is null or target_value >= 0),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Recurring work. days_of_week uses ISO numbering: 1 = Monday ... 7 = Sunday.
-- metric_amount is how much one session adds to its metric (e.g. 2 problems).
create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  days_of_week smallint[] not null check (
    cardinality(days_of_week) between 1 and 7 and days_of_week <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ),
  minutes integer not null check (minutes between 5 and 600),
  preferred_start time,
  preferred_end time,
  energy_level text check (energy_level is null or energy_level in ('low', 'medium', 'high')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  goal_metric_id uuid references public.goal_metrics(id) on delete set null,
  metric_amount numeric check (metric_amount is null or metric_amount > 0),
  start_date date not null default current_date,
  end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routines_end_after_start check (end_date is null or end_date >= start_date),
  constraint routines_window_order check (preferred_start is null or preferred_end is null or preferred_end > preferred_start)
);

-- One value per metric per day, written by the evening log. Re-saving a day
-- replaces its value instead of adding a second row.
create table if not exists public.progress_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_metric_id uuid not null references public.goal_metrics(id) on delete cascade,
  log_date date not null,
  value numeric not null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint progress_logs_one_per_day unique (goal_metric_id, log_date)
);

-- The AI's note after the evening log. suggestions holds the adjustment
-- proposals and whether each was applied or dismissed; the app validates it.
create table if not exists public.daily_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  feedback_date date not null,
  source text not null check (source in ('ai', 'fallback')),
  summary text not null check (char_length(summary) between 1 and 1000),
  suggestions jsonb not null default '[]'::jsonb check (jsonb_typeof(suggestions) = 'array'),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_feedback_one_per_day unique (user_id, feedback_date)
);

-- Tasks created from a routine remember which routine and day they are for,
-- so a routine can only ever create one task per day.
alter table public.tasks
  add column if not exists routine_id uuid references public.routines(id) on delete set null,
  add column if not exists occurrence_date date;

do $$ begin
  alter table public.tasks add constraint tasks_routine_has_date
    check (routine_id is null or occurrence_date is not null);
exception when duplicate_object then null; end $$;

create unique index if not exists tasks_one_per_routine_day on public.tasks (routine_id, occurrence_date) where routine_id is not null;

-- Indexes for foreign keys and the common per-user, per-date reads.
create index if not exists goal_metrics_goal_id_idx on public.goal_metrics(goal_id);
create index if not exists goal_phases_goal_id_idx on public.goal_phases(goal_id);
create index if not exists weekly_targets_user_week_idx on public.weekly_targets(user_id, week_start);
create index if not exists weekly_targets_goal_id_idx on public.weekly_targets(goal_id);
create index if not exists weekly_targets_metric_id_idx on public.weekly_targets(goal_metric_id);
create index if not exists routines_user_id_idx on public.routines(user_id);
create index if not exists routines_goal_id_idx on public.routines(goal_id);
create index if not exists routines_metric_id_idx on public.routines(goal_metric_id);
create index if not exists progress_logs_user_date_idx on public.progress_logs(user_id, log_date);
create index if not exists tasks_occurrence_date_idx on public.tasks(user_id, occurrence_date) where occurrence_date is not null;

-- ---------------------------------------------------------------------------
-- Row-level security, grants, updated_at
-- ---------------------------------------------------------------------------

do $$
declare
  table_name text;
begin
  foreach table_name in array array['goal_metrics', 'goal_phases', 'weekly_targets', 'routines', 'progress_logs', 'daily_feedback']
  loop
    execute format('alter table public.%1$s enable row level security', table_name);
    execute format('drop policy if exists "Users can view their own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users can view their own %1$s" on public.%1$s for select to authenticated using ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists "Users can insert their own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users can insert their own %1$s" on public.%1$s for insert to authenticated with check ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists "Users can update their own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users can update their own %1$s" on public.%1$s for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists "Users can delete their own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users can delete their own %1$s" on public.%1$s for delete to authenticated using ((select auth.uid()) = user_id)', table_name);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', table_name);
    execute format('drop trigger if exists %1$s_set_updated_at on public.%1$s', table_name);
    execute format('create trigger %1$s_set_updated_at before update on public.%1$s for each row execute procedure public.set_updated_at()', table_name);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cross-user reference checks
-- ---------------------------------------------------------------------------

-- goal_metrics, goal_phases: the goal must be the row owner's.
create or replace function public.check_goal_child_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.goals g where g.id = new.goal_id and g.user_id = new.user_id) then
    raise exception 'goal_id % does not belong to user %', new.goal_id, new.user_id using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists goal_metrics_check_owner on public.goal_metrics;
create trigger goal_metrics_check_owner before insert or update on public.goal_metrics
  for each row execute procedure public.check_goal_child_owner();
drop trigger if exists goal_phases_check_owner on public.goal_phases;
create trigger goal_phases_check_owner before insert or update on public.goal_phases
  for each row execute procedure public.check_goal_child_owner();

-- weekly_targets, routines: the goal must be the owner's, and a metric must
-- be the owner's and belong to that same goal.
create or replace function public.check_goal_metric_ref_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.goal_id is not null and not exists (
    select 1 from public.goals g where g.id = new.goal_id and g.user_id = new.user_id
  ) then
    raise exception 'goal_id % does not belong to user %', new.goal_id, new.user_id using errcode = '23503';
  end if;
  if new.goal_metric_id is not null and not exists (
    select 1 from public.goal_metrics m
    where m.id = new.goal_metric_id and m.user_id = new.user_id and m.goal_id is not distinct from new.goal_id
  ) then
    raise exception 'goal_metric_id % does not belong to goal % of user %', new.goal_metric_id, new.goal_id, new.user_id using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists weekly_targets_check_owner on public.weekly_targets;
create trigger weekly_targets_check_owner before insert or update on public.weekly_targets
  for each row execute procedure public.check_goal_metric_ref_owner();
drop trigger if exists routines_check_owner on public.routines;
create trigger routines_check_owner before insert or update on public.routines
  for each row execute procedure public.check_goal_metric_ref_owner();

-- progress_logs: the metric must be the owner's.
create or replace function public.check_progress_log_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.goal_metrics m where m.id = new.goal_metric_id and m.user_id = new.user_id) then
    raise exception 'goal_metric_id % does not belong to user %', new.goal_metric_id, new.user_id using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists progress_logs_check_owner on public.progress_logs;
create trigger progress_logs_check_owner before insert or update on public.progress_logs
  for each row execute procedure public.check_progress_log_owner();

-- tasks: the existing goal/project/milestone checks, plus the new routine.
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

  if new.routine_id is not null and not exists (
    select 1 from public.routines r where r.id = new.routine_id and r.user_id = new.user_id
  ) then
    raise exception 'routine_id % does not belong to user %', new.routine_id, new.user_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- New functions start with EXECUTE granted to PUBLIC. As in the Day 13
-- hardening, no API role may call a trigger function directly.
-- ---------------------------------------------------------------------------

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
