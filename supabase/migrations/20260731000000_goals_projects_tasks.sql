-- Day 2: durable data model for goals, projects, milestones, tasks,
-- task dependencies, and task sessions. Every table is user-owned and
-- protected by Row Level Security keyed to auth.uid().

-- ---------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.goals enable row level security;

create policy "Users can view their own goals"
  on public.goals for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert their own goals"
  on public.goals for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own goals"
  on public.goals for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own goals"
  on public.goals for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists goals_user_id_idx on public.goals(user_id);

-- ---------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

create policy "Users can view their own projects"
  on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert their own projects"
  on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own projects"
  on public.projects for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own projects"
  on public.projects for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists projects_user_id_idx on public.projects(user_id);
create index if not exists projects_goal_id_idx on public.projects(goal_id);

-- ---------------------------------------------------------------------
-- milestones
-- ---------------------------------------------------------------------
create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  due_date date,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.milestones enable row level security;

create policy "Users can view their own milestones"
  on public.milestones for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert their own milestones"
  on public.milestones for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own milestones"
  on public.milestones for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own milestones"
  on public.milestones for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists milestones_user_id_idx on public.milestones(user_id);
create index if not exists milestones_project_id_idx on public.milestones(project_id);

-- ---------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  milestone_id uuid references public.milestones(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  category text,
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'completed', 'skipped', 'deferred')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  actual_minutes integer check (actual_minutes is null or actual_minutes >= 0),
  due_date date,
  energy_level text check (energy_level is null or energy_level in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.tasks enable row level security;

create policy "Users can view their own tasks"
  on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert their own tasks"
  on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own tasks"
  on public.tasks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own tasks"
  on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists tasks_user_id_idx on public.tasks(user_id);
create index if not exists tasks_goal_id_idx on public.tasks(goal_id);
create index if not exists tasks_project_id_idx on public.tasks(project_id);
create index if not exists tasks_milestone_id_idx on public.tasks(milestone_id);
create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_due_date_idx on public.tasks(due_date);

-- Keep completed_at consistent with status without trusting client input.
create or replace function public.sync_task_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at = now();
  elsif new.status <> 'completed' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create trigger tasks_sync_completed_at
  before insert or update on public.tasks
  for each row execute procedure public.sync_task_completed_at();

-- ---------------------------------------------------------------------
-- task_dependencies (task_id depends on depends_on_task_id)
-- ---------------------------------------------------------------------
create table if not exists public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint task_dependencies_no_self_reference check (task_id <> depends_on_task_id),
  constraint task_dependencies_unique unique (task_id, depends_on_task_id)
);

alter table public.task_dependencies enable row level security;

create policy "Users can view their own task dependencies"
  on public.task_dependencies for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert their own task dependencies"
  on public.task_dependencies for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can delete their own task dependencies"
  on public.task_dependencies for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists task_dependencies_user_id_idx on public.task_dependencies(user_id);
create index if not exists task_dependencies_task_id_idx on public.task_dependencies(task_id);

-- ---------------------------------------------------------------------
-- task_sessions (time actually spent working a task)
-- ---------------------------------------------------------------------
create table if not exists public.task_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  minutes integer check (minutes is null or minutes >= 0),
  notes text,
  created_at timestamptz not null default now(),
  constraint task_sessions_end_after_start check (ended_at is null or ended_at >= started_at)
);

alter table public.task_sessions enable row level security;

create policy "Users can view their own task sessions"
  on public.task_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert their own task sessions"
  on public.task_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own task sessions"
  on public.task_sessions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own task sessions"
  on public.task_sessions for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists task_sessions_user_id_idx on public.task_sessions(user_id);
create index if not exists task_sessions_task_id_idx on public.task_sessions(task_id);

-- ---------------------------------------------------------------------
-- updated_at triggers (reuse the helper created in the Day 1 migration)
-- ---------------------------------------------------------------------
create trigger goals_set_updated_at
  before update on public.goals
  for each row execute procedure public.set_updated_at();

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute procedure public.set_updated_at();

create trigger milestones_set_updated_at
  before update on public.milestones
  for each row execute procedure public.set_updated_at();

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------
-- Seed real starter goals for every new user (extends Day 1's
-- handle_new_user trigger rather than replacing its profile insert).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);

  insert into public.goals (user_id, title, description)
  values
    (new.id, 'DSA', 'Data structures and algorithms practice.'),
    (new.id, 'Full-stack', 'Build and ship full-stack projects.'),
    (new.id, 'Placements', 'Interview preparation and applications.'),
    (new.id, 'College', 'Coursework and academic responsibilities.'),
    (new.id, 'Gym', 'Training and fitness routine.');

  return new;
end;
$$;

-- Seed the same starter goals for any user created before this migration
-- ran, so the acceptance check works for existing test accounts too.
insert into public.goals (user_id, title, description)
select p.id, seed.title, seed.description
from public.profiles p
cross join (
  values
    ('DSA', 'Data structures and algorithms practice.'),
    ('Full-stack', 'Build and ship full-stack projects.'),
    ('Placements', 'Interview preparation and applications.'),
    ('College', 'Coursework and academic responsibilities.'),
    ('Gym', 'Training and fitness routine.')
) as seed(title, description)
where not exists (
  select 1 from public.goals g where g.user_id = p.id and g.title = seed.title
);
