-- Google Planner calendar and event mappings.
-- These tables are server-only. Application code accesses them through the
-- Supabase service-role client after the authenticated user has been checked.

create table if not exists public.google_planner_calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_id text not null check (char_length(calendar_id) between 1 and 512),
  summary text not null default 'AI Planner' check (char_length(summary) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_planner_calendars_user_unique unique (user_id),
  constraint google_planner_calendars_user_calendar_unique unique (user_id, calendar_id)
);

create table if not exists public.google_planner_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_plan_id uuid not null references public.daily_plans(id) on delete cascade,
  plan_block_id uuid not null references public.plan_blocks(id) on delete cascade,
  google_event_id text not null check (char_length(google_event_id) between 1 and 512),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_planner_events_plan_block_unique unique (daily_plan_id, plan_block_id),
  constraint google_planner_events_user_google_event_unique unique (user_id, google_event_id)
);

alter table public.google_planner_calendars enable row level security;
alter table public.google_planner_events enable row level security;

-- No authenticated/anon policies or grants are intentional: mappings are
-- accessed only by server-side service-role code.
revoke all on table public.google_planner_calendars from anon, authenticated;
revoke all on table public.google_planner_events from anon, authenticated;
grant select, insert, update, delete on table public.google_planner_calendars to service_role;
grant select, insert, update, delete on table public.google_planner_events to service_role;

create index if not exists google_planner_calendars_user_idx
  on public.google_planner_calendars(user_id);

create index if not exists google_planner_events_user_plan_date_idx
  on public.google_planner_events(user_id, daily_plan_id);

create index if not exists google_planner_events_plan_block_idx
  on public.google_planner_events(plan_block_id);

create or replace function public.set_google_planner_mappings_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists google_planner_calendars_updated_at on public.google_planner_calendars;
create trigger google_planner_calendars_updated_at
before update on public.google_planner_calendars
for each row execute function public.set_google_planner_mappings_updated_at();

drop trigger if exists google_planner_events_updated_at on public.google_planner_events;
create trigger google_planner_events_updated_at
before update on public.google_planner_events
for each row execute function public.set_google_planner_mappings_updated_at();

create or replace function public.check_google_planner_event_references_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.daily_plans p
    where p.id = new.daily_plan_id
      and p.user_id = new.user_id
  ) then
    raise exception 'daily_plan_id % does not belong to user %', new.daily_plan_id, new.user_id
      using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.plan_blocks b
    where b.id = new.plan_block_id
      and b.daily_plan_id = new.daily_plan_id
      and b.user_id = new.user_id
  ) then
    raise exception 'plan_block_id % does not belong to user % or daily_plan_id %',
      new.plan_block_id, new.user_id, new.daily_plan_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists google_planner_events_check_references_owner
  on public.google_planner_events;
create trigger google_planner_events_check_references_owner
before insert or update on public.google_planner_events
for each row execute function public.check_google_planner_event_references_owner();
