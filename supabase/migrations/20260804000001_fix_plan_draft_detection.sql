-- Day 5 follow-up: Fix PL/pgSQL row-value evaluation bug where IS NOT NULL fails on rows with NULL fields.

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
