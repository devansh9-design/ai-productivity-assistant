-- Day 9: per-user planning preferences and a gym/exercise availability kind.
-- Follows the RLS, grant, and updated_at patterns of the earlier migrations.

create table if not exists public.planning_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  buffer_percent smallint not null default 20
    check (buffer_percent between 0 and 50),
  low_energy_max_block_minutes smallint not null default 45
    check (low_energy_max_block_minutes between 15 and 240),
  adapt_to_actual_durations boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.planning_preferences enable row level security;

drop policy if exists "Users can view their own planning preferences" on public.planning_preferences;
create policy "Users can view their own planning preferences"
  on public.planning_preferences for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own planning preferences" on public.planning_preferences;
create policy "Users can insert their own planning preferences"
  on public.planning_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own planning preferences" on public.planning_preferences;
create policy "Users can update their own planning preferences"
  on public.planning_preferences for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own planning preferences" on public.planning_preferences;
create policy "Users can delete their own planning preferences"
  on public.planning_preferences for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.planning_preferences to authenticated;

drop trigger if exists planning_preferences_set_updated_at on public.planning_preferences;
create trigger planning_preferences_set_updated_at
  before update on public.planning_preferences
  for each row execute procedure public.set_updated_at();

-- Gym/exercise is reserved time, like sleep or meals. Every kind other than
-- working and high_focus is already treated as a reservation by the engine,
-- the planner, and edit_draft_plan_block, so no function changes are needed.
alter table public.availability_rules
  drop constraint if exists availability_rules_kind_check;
alter table public.availability_rules
  add constraint availability_rules_kind_check
  check (kind in ('working', 'high_focus', 'sleep', 'meal', 'travel', 'break', 'exercise'));
