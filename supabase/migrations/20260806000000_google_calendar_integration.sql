-- Day 6: Google Calendar read integration.
-- Adds google_credentials table for secure server-side token storage,
-- and updates plan_blocks constraints to support 'calendar' block kind.
-- This is an additive migration; no old migration files are modified.

-- ---------------------------------------------------------------------------
-- 1. Google credentials table (server-side only, zero authenticated policies)
-- ---------------------------------------------------------------------------

create table if not exists public.google_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS enabled with ZERO policies for authenticated users.
-- All operations go through the service-role client only.
alter table public.google_credentials enable row level security;

-- Explicitly grant only the necessary CRUD operations to the server-only service_role.
-- Do NOT grant to authenticated or anon to keep credentials inaccessible to normal clients.
grant select, insert, update, delete on table public.google_credentials to service_role;

drop trigger if exists google_credentials_set_updated_at on public.google_credentials;
create trigger google_credentials_set_updated_at
  before update on public.google_credentials
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Extend plan_blocks to support 'calendar' kind
-- ---------------------------------------------------------------------------

-- Drop the inline check constraint on kind (auto-named by PostgreSQL as plan_blocks_kind_check)
alter table public.plan_blocks drop constraint if exists plan_blocks_kind_check;
-- Re-add with 'calendar' included
alter table public.plan_blocks add constraint plan_blocks_kind_check
  check (kind in ('task', 'buffer', 'calendar'));

-- Drop and re-add the task_shape constraint to allow calendar blocks with null task_id
alter table public.plan_blocks drop constraint if exists plan_blocks_task_shape;
alter table public.plan_blocks add constraint plan_blocks_task_shape check (
  (kind = 'task' and task_id is not null)
  or (kind in ('buffer', 'calendar') and task_id is null)
);
