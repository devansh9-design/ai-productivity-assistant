-- Day 4: deterministic daily scheduling. All rows remain user-owned and
-- follow the RLS, grants, ownership-trigger, index, and updated_at patterns
-- established by the earlier migrations.

alter table public.tasks
  add column if not exists urgency smallint not null default 3 check (urgency between 1 and 5),
  add column if not exists impact smallint not null default 3 check (impact between 1 and 5),
  add column if not exists must_do boolean not null default false;

create index if not exists tasks_scheduler_candidates_idx
  on public.tasks(user_id, status, must_do, due_date);

create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  kind text not null check (kind in ('working', 'high_focus', 'sleep', 'meal', 'travel', 'break')),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_rules_time_order check (end_time > start_time)
);

create table if not exists public.fixed_commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  commitment_date date not null,
  title text not null check (char_length(title) between 1 and 200),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_commitments_time_order check (end_time > start_time)
);

create table if not exists public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_date date not null,
  buffer_minutes integer not null default 0 check (buffer_minutes >= 0),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_plans_unique_per_user_and_date unique (user_id, plan_date)
);

create table if not exists public.plan_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  daily_plan_id uuid not null references public.daily_plans(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  kind text not null check (kind in ('task', 'buffer')),
  title text not null check (char_length(title) between 1 and 200),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_blocks_time_order check (end_time > start_time),
  constraint plan_blocks_task_shape check (
    (kind = 'task' and task_id is not null) or (kind = 'buffer' and task_id is null)
  )
);

create table if not exists public.plan_unscheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  daily_plan_id uuid not null references public.daily_plans(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint plan_unscheduled_tasks_unique unique (daily_plan_id, task_id)
);

alter table public.availability_rules enable row level security;
alter table public.fixed_commitments enable row level security;
alter table public.daily_plans enable row level security;
alter table public.plan_blocks enable row level security;
alter table public.plan_unscheduled_tasks enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['availability_rules', 'fixed_commitments', 'daily_plans', 'plan_blocks', 'plan_unscheduled_tasks']
  loop
    execute format('drop policy if exists "Users can view their own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users can view their own %1$s" on public.%1$s for select to authenticated using ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists "Users can insert their own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users can insert their own %1$s" on public.%1$s for insert to authenticated with check ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists "Users can update their own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users can update their own %1$s" on public.%1$s for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists "Users can delete their own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users can delete their own %1$s" on public.%1$s for delete to authenticated using ((select auth.uid()) = user_id)', table_name);
  end loop;
end;
$$;

create index if not exists availability_rules_user_weekday_idx on public.availability_rules(user_id, weekday);
create index if not exists fixed_commitments_user_date_idx on public.fixed_commitments(user_id, commitment_date);
create index if not exists daily_plans_user_date_idx on public.daily_plans(user_id, plan_date);
create index if not exists plan_blocks_daily_plan_idx on public.plan_blocks(daily_plan_id, start_time);
create index if not exists plan_blocks_task_id_idx on public.plan_blocks(task_id);
create index if not exists plan_unscheduled_tasks_daily_plan_idx on public.plan_unscheduled_tasks(daily_plan_id);
create index if not exists plan_unscheduled_tasks_task_id_idx on public.plan_unscheduled_tasks(task_id);

drop trigger if exists availability_rules_set_updated_at on public.availability_rules;
create trigger availability_rules_set_updated_at before update on public.availability_rules for each row execute procedure public.set_updated_at();
drop trigger if exists fixed_commitments_set_updated_at on public.fixed_commitments;
create trigger fixed_commitments_set_updated_at before update on public.fixed_commitments for each row execute procedure public.set_updated_at();
drop trigger if exists daily_plans_set_updated_at on public.daily_plans;
create trigger daily_plans_set_updated_at before update on public.daily_plans for each row execute procedure public.set_updated_at();
drop trigger if exists plan_blocks_set_updated_at on public.plan_blocks;
create trigger plan_blocks_set_updated_at before update on public.plan_blocks for each row execute procedure public.set_updated_at();

create or replace function public.check_plan_block_references_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.daily_plans p where p.id = new.daily_plan_id and p.user_id = new.user_id) then
    raise exception 'daily_plan_id % does not belong to user %', new.daily_plan_id, new.user_id using errcode = '23503';
  end if;
  if new.task_id is not null and not exists (select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id) then
    raise exception 'task_id % does not belong to user %', new.task_id, new.user_id using errcode = '23503';
  end if;
  return new;
end;
$$;

create or replace function public.check_plan_unscheduled_task_references_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.daily_plans p where p.id = new.daily_plan_id and p.user_id = new.user_id) then
    raise exception 'daily_plan_id % does not belong to user %', new.daily_plan_id, new.user_id using errcode = '23503';
  end if;
  if not exists (select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id) then
    raise exception 'task_id % does not belong to user %', new.task_id, new.user_id using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists plan_blocks_check_references_owner on public.plan_blocks;
create trigger plan_blocks_check_references_owner before insert or update on public.plan_blocks for each row execute procedure public.check_plan_block_references_owner();
drop trigger if exists plan_unscheduled_tasks_check_references_owner on public.plan_unscheduled_tasks;
create trigger plan_unscheduled_tasks_check_references_owner before insert or update on public.plan_unscheduled_tasks for each row execute procedure public.check_plan_unscheduled_task_references_owner();

create or replace function public.replace_daily_plan(
  p_user_id uuid,
  p_plan_date date,
  p_buffer_minutes integer,
  p_generated_at timestamptz,
  p_blocks jsonb,
  p_unscheduled jsonb
)
returns public.daily_plans
language plpgsql
set search_path = ''
as $$
declare
  persisted_plan public.daily_plans;
begin
  if (select auth.uid()) is distinct from p_user_id then
    raise exception 'Not authorized to modify this daily plan' using errcode = '42501';
  end if;

  insert into public.daily_plans (user_id, plan_date, buffer_minutes, generated_at)
  values (p_user_id, p_plan_date, p_buffer_minutes, p_generated_at)
  on conflict (user_id, plan_date) do update
    set buffer_minutes = excluded.buffer_minutes,
        generated_at = excluded.generated_at,
        updated_at = now()
  returning * into persisted_plan;

  perform 1
  from public.daily_plans
  where id = persisted_plan.id and user_id = p_user_id
  for update;

  delete from public.plan_blocks
  where daily_plan_id = persisted_plan.id
    and user_id = p_user_id;

  delete from public.plan_unscheduled_tasks
  where daily_plan_id = persisted_plan.id
    and user_id = p_user_id;

  insert into public.plan_blocks (user_id, daily_plan_id, task_id, kind, title, start_time, end_time)
  select
    p_user_id,
    persisted_plan.id,
    block.task_id,
    block.kind,
    block.title,
    block.start_time,
    block.end_time
  from jsonb_to_recordset(coalesce(p_blocks, '[]'::jsonb)) as block(
    task_id uuid,
    kind text,
    title text,
    start_time time,
    end_time time
  );

  insert into public.plan_unscheduled_tasks (user_id, daily_plan_id, task_id, reason)
  select
    p_user_id,
    persisted_plan.id,
    item.task_id,
    item.reason
  from jsonb_to_recordset(coalesce(p_unscheduled, '[]'::jsonb)) as item(
    task_id uuid,
    reason text
  );

  return persisted_plan;
end;
$$;

grant select, insert, update, delete on public.availability_rules to authenticated;
grant select, insert, update, delete on public.fixed_commitments to authenticated;
grant select, insert, update, delete on public.daily_plans to authenticated;
grant select, insert, update, delete on public.plan_blocks to authenticated;
grant select, insert, update, delete on public.plan_unscheduled_tasks to authenticated;
grant execute on function public.replace_daily_plan(uuid, date, integer, timestamptz, jsonb, jsonb) to authenticated;
