-- Lock Google Planner mapping tables to server-side service-role access.
-- Older deployed migrations created user-scoped policies on these tables.
-- Those policies are redundant for the current architecture and must not
-- remain as a latent access path if grants change later.

alter table public.google_planner_calendars enable row level security;
alter table public.google_planner_events enable row level security;

drop policy if exists "Users can view their planner calendar" on public.google_planner_calendars;
drop policy if exists "Users can insert their planner calendar" on public.google_planner_calendars;
drop policy if exists "Users can update their planner calendar" on public.google_planner_calendars;
drop policy if exists "Users can delete their planner calendar" on public.google_planner_calendars;

drop policy if exists "Users can view their planner events" on public.google_planner_events;
drop policy if exists "Users can insert their planner events" on public.google_planner_events;
drop policy if exists "Users can update their planner events" on public.google_planner_events;
drop policy if exists "Users can delete their planner events" on public.google_planner_events;

revoke all on table public.google_planner_calendars from public, anon, authenticated;
revoke all on table public.google_planner_events from public, anon, authenticated;

grant select, insert, update, delete on table public.google_planner_calendars to service_role;
grant select, insert, update, delete on table public.google_planner_events to service_role;
