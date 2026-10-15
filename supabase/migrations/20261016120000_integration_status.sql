-- Day 12: per-user integration status and pause switches.
-- One row per user and integration (only Google Calendar for now). The app
-- reads it on every calendar operation, so a pause takes effect on the server
-- even when an old page is still open. Error columns hold an app-defined code
-- and a short app-written message only: never tokens or Google's responses.
-- Follows the RLS, grant, and updated_at patterns of the earlier migrations.

create table if not exists public.integration_status (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google_calendar')),
  planning_enabled boolean not null default true,
  publishing_enabled boolean not null default true,
  needs_reconnect boolean not null default false,
  last_read_at timestamptz,
  last_published_at timestamptz,
  last_error_at timestamptz,
  last_error_operation text check (last_error_operation in ('read', 'publish')),
  last_error_code text check (last_error_code in ('reconnect_required', 'permission_denied', 'unavailable')),
  last_error_message text check (char_length(last_error_message) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider),
  -- An error is recorded completely or not at all.
  constraint integration_status_error_complete check (
    (last_error_at is null) = (last_error_code is null)
    and (last_error_code is null) = (last_error_operation is null)
    and (last_error_code is null) = (last_error_message is null)
  )
);

alter table public.integration_status enable row level security;

drop policy if exists "Users can view their own integration status" on public.integration_status;
create policy "Users can view their own integration status"
  on public.integration_status for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own integration status" on public.integration_status;
create policy "Users can insert their own integration status"
  on public.integration_status for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own integration status" on public.integration_status;
create policy "Users can update their own integration status"
  on public.integration_status for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own integration status" on public.integration_status;
create policy "Users can delete their own integration status"
  on public.integration_status for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.integration_status to authenticated;

drop trigger if exists integration_status_set_updated_at on public.integration_status;
create trigger integration_status_set_updated_at
  before update on public.integration_status
  for each row execute procedure public.set_updated_at();
