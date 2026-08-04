-- Day 5: plan generation, editing, and confirmation workflow.
-- Adds plan versioning (status, version, parent_plan_id), block editing
-- (sort_order, is_manual), and new RPCs for the draft->confirmed lifecycle.
-- This is an additive migration; no old migration files are modified.

-- ---------------------------------------------------------------------------
-- 1. Extend daily_plans with status lifecycle and versioning
-- ---------------------------------------------------------------------------

alter table public.daily_plans
  add column if not exists status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'superseded', 'completed')),
  add column if not exists version smallint not null default 1,
  add column if not exists parent_plan_id uuid references public.daily_plans(id);

-- The Day 4 unique constraint only allowed one plan per user+date.
-- Day 5 allows multiple versions; only one may be active (draft or confirmed).
alter table public.daily_plans
  drop constraint if exists daily_plans_unique_per_user_and_date;

create unique index if not exists daily_plans_one_active_per_date
  on public.daily_plans(user_id, plan_date)
  where status in ('draft', 'confirmed');

create index if not exists daily_plans_date_version_idx
  on public.daily_plans(user_id, plan_date, version desc);

-- ---------------------------------------------------------------------------
-- 2. Extend plan_blocks with editing support
-- ---------------------------------------------------------------------------

alter table public.plan_blocks
  add column if not exists sort_order smallint not null default 0,
  add column if not exists is_manual boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3. create_draft_plan -- atomic draft creation with versioning
-- ---------------------------------------------------------------------------

create or replace function public.create_draft_plan(
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
  v_existing public.daily_plans;
  v_latest public.daily_plans;
  v_new_version smallint;
  v_result public.daily_plans;
begin
  -- Auth check
  if (select auth.uid()) is distinct from p_user_id then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- Acquire advisory lock to prevent concurrent plan creation for this user+date
  perform pg_advisory_xact_lock(
    hashtext(p_user_id::text || p_plan_date::text)
  );

  -- Check for existing active plan
  select * into v_existing
  from public.daily_plans
  where user_id = p_user_id
    and plan_date = p_plan_date
    and status in ('draft', 'confirmed')
  limit 1
  for update;

  if v_existing.id is not null and v_existing.status = 'confirmed' then
    -- Supersede the confirmed plan and create a new version
    update public.daily_plans
    set status = 'superseded', updated_at = now()
    where id = v_existing.id;

    v_new_version := v_existing.version + 1;

    insert into public.daily_plans
      (user_id, plan_date, buffer_minutes, generated_at, status, version, parent_plan_id)
    values
      (p_user_id, p_plan_date, p_buffer_minutes, p_generated_at, 'draft', v_new_version, v_existing.id)
    returning * into v_result;

  elsif v_existing.id is not null and v_existing.status = 'draft' then
    -- Reuse existing draft: clear its children and update metadata
    delete from public.plan_blocks
    where daily_plan_id = v_existing.id and user_id = p_user_id;

    delete from public.plan_unscheduled_tasks
    where daily_plan_id = v_existing.id and user_id = p_user_id;

    update public.daily_plans
    set buffer_minutes = p_buffer_minutes,
        generated_at = p_generated_at,
        updated_at = now()
    where id = v_existing.id
    returning * into v_result;

  else
    -- No active plan (e.g. all previous plans are completed or superseded):
    -- Calculate version = COALESCE(MAX(version), 0) + 1 and link parent_plan_id if a previous plan exists.
    select * into v_latest
    from public.daily_plans
    where user_id = p_user_id
      and plan_date = p_plan_date
    order by version desc
    limit 1;

    v_new_version := coalesce(v_latest.version, 0) + 1;

    insert into public.daily_plans
      (user_id, plan_date, buffer_minutes, generated_at, status, version, parent_plan_id)
    values
      (p_user_id, p_plan_date, p_buffer_minutes, p_generated_at, 'draft', v_new_version, v_latest.id)
    returning * into v_result;
  end if;

  -- Insert blocks
  insert into public.plan_blocks
    (user_id, daily_plan_id, task_id, kind, title, start_time, end_time, sort_order, is_manual)
  select
    p_user_id,
    v_result.id,
    (block->>'task_id')::uuid,
    block->>'kind',
    block->>'title',
    (block->>'start_time')::time,
    (block->>'end_time')::time,
    coalesce((block->>'sort_order')::smallint, idx::smallint),
    coalesce((block->>'is_manual')::boolean, false)
  from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb))
    with ordinality as t(block, idx);

  -- Insert unscheduled
  insert into public.plan_unscheduled_tasks (user_id, daily_plan_id, task_id, reason)
  select
    p_user_id,
    v_result.id,
    (item->>'task_id')::uuid,
    item->>'reason'
  from jsonb_array_elements(coalesce(p_unscheduled, '[]'::jsonb)) as item;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. confirm_daily_plan -- transitions draft -> confirmed
-- ---------------------------------------------------------------------------

create or replace function public.confirm_daily_plan(p_plan_id uuid)
returns public.daily_plans
language plpgsql
set search_path = ''
as $$
declare
  v_plan public.daily_plans;
begin
  select * into v_plan
  from public.daily_plans
  where id = p_plan_id
  for update;

  if v_plan is null then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;

  if (select auth.uid()) is distinct from v_plan.user_id then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_plan.status <> 'draft' then
    raise exception 'Only draft plans can be confirmed (current status: %)', v_plan.status
      using errcode = 'P0001';
  end if;

  update public.daily_plans
  set status = 'confirmed', updated_at = now()
  where id = p_plan_id
  returning * into v_plan;

  return v_plan;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Atomic draft-only block mutation RPCs
-- ---------------------------------------------------------------------------

create or replace function public.delete_draft_plan_block(p_block_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select p.status into v_status
  from public.plan_blocks b
  join public.daily_plans p on p.id = b.daily_plan_id
  where b.id = p_block_id and b.user_id = (select auth.uid())
  for update of p;

  if v_status is null then
    raise exception 'Block not found' using errcode = 'P0002';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only blocks in a draft plan can be removed (current plan status: %)', v_status
      using errcode = 'P0001';
  end if;

  delete from public.plan_blocks where id = p_block_id;
end;
$$;

create or replace function public.edit_draft_plan_block(
  p_block_id uuid,
  p_start_time time,
  p_end_time time
)
returns public.plan_blocks
language plpgsql
set search_path = ''
as $$
declare
  v_plan public.daily_plans;
  v_block public.plan_blocks;
  v_updated public.plan_blocks;
  v_weekday smallint;
begin
  if p_end_time <= p_start_time then
    raise exception 'Choose a valid same-day start and end time.' using errcode = '22023';
  end if;

  select b.* into v_block
  from public.plan_blocks b
  where b.id = p_block_id and b.user_id = (select auth.uid());

  if v_block is null then
    raise exception 'Block not found' using errcode = 'P0002';
  end if;

  select p.* into v_plan
  from public.daily_plans p
  where p.id = v_block.daily_plan_id and p.user_id = (select auth.uid())
  for update;

  if v_plan.status <> 'draft' then
    raise exception 'Only blocks in a draft plan can be edited (current plan status: %)', v_plan.status
      using errcode = 'P0001';
  end if;

  -- Overlap check: other blocks in the same plan
  if exists (
    select 1 from public.plan_blocks sibling
    where sibling.daily_plan_id = v_plan.id
      and sibling.id <> p_block_id
      and sibling.start_time < p_end_time
      and sibling.end_time > p_start_time
  ) then
    raise exception 'New time overlaps with another block in this plan.' using errcode = 'P0001';
  end if;

  -- Overlap check: fixed commitments for that date
  if exists (
    select 1 from public.fixed_commitments fc
    where fc.user_id = (select auth.uid())
      and fc.commitment_date = v_plan.plan_date
      and fc.start_time < p_end_time
      and fc.end_time > p_start_time
  ) then
    raise exception 'New time overlaps with a fixed commitment.' using errcode = 'P0001';
  end if;

  -- Working hours check
  v_weekday := extract(isodow from v_plan.plan_date)::integer % 7;
  if not exists (
    select 1 from public.availability_rules ar
    where ar.user_id = (select auth.uid())
      and ar.weekday = v_weekday
      and ar.kind = 'working'
      and ar.start_time <= p_start_time
      and ar.end_time >= p_end_time
  ) then
    raise exception 'Block must fall within configured working hours.' using errcode = 'P0001';
  end if;

  -- Reservations check
  if exists (
    select 1 from public.availability_rules ar
    where ar.user_id = (select auth.uid())
      and ar.weekday = v_weekday
      and ar.kind not in ('working', 'high_focus')
      and ar.start_time < p_end_time
      and ar.end_time > p_start_time
  ) then
    raise exception 'Block overlaps with a reserved availability window.' using errcode = 'P0001';
  end if;

  update public.plan_blocks
  set start_time = p_start_time,
      end_time = p_end_time,
      is_manual = true,
      updated_at = now()
  where id = p_block_id
  returning * into v_updated;

  return v_updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants for new functions
-- ---------------------------------------------------------------------------

grant execute on function public.create_draft_plan(uuid, date, integer, timestamptz, jsonb, jsonb) to authenticated;
grant execute on function public.confirm_daily_plan(uuid) to authenticated;
grant execute on function public.delete_draft_plan_block(uuid) to authenticated;
grant execute on function public.edit_draft_plan_block(uuid, time, time) to authenticated;
