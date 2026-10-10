-- Give publication attempts a lease so a process crash cannot strand a plan.

alter table public.daily_plans
  add column if not exists publication_started_at timestamptz;

create or replace function public.begin_daily_plan_publication(p_plan_id uuid)
returns public.daily_plans language plpgsql set search_path = '' as $$
declare v_plan public.daily_plans;
begin
  select * into v_plan from public.daily_plans
  where id = p_plan_id and user_id = (select auth.uid()) for update;
  if v_plan is null then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  if v_plan.status = 'publishing' and v_plan.publication_started_at is not null
     and v_plan.publication_started_at <= now() - interval '10 minutes' then
    update public.daily_plans set status = 'publication_failed', updated_at = now()
    where id = p_plan_id;
    v_plan.status := 'publication_failed';
  end if;
  if v_plan.status not in ('draft', 'publication_failed') then
    raise exception 'Only draft or failed plans can be published (current status: %)', v_plan.status using errcode = 'P0001';
  end if;
  update public.daily_plans
  set status = 'publishing', publication_started_at = now(), updated_at = now()
  where id = p_plan_id returning * into v_plan;
  return v_plan;
end; $$;

create or replace function public.fail_daily_plan_publication(p_plan_id uuid)
returns public.daily_plans language plpgsql set search_path = '' as $$
declare v_plan public.daily_plans;
begin
  update public.daily_plans
  set status = 'publication_failed', publication_started_at = null, updated_at = now()
  where id = p_plan_id and user_id = (select auth.uid()) and status = 'publishing'
  returning * into v_plan;
  if v_plan is null then raise exception 'Publishing plan not found' using errcode = 'P0002'; end if;
  return v_plan;
end; $$;

create or replace function public.complete_daily_plan_publication(p_plan_id uuid)
returns public.daily_plans language plpgsql set search_path = '' as $$
declare v_plan public.daily_plans;
begin
  update public.daily_plans
  set status = 'confirmed', publication_started_at = null, updated_at = now()
  where id = p_plan_id and user_id = (select auth.uid()) and status = 'publishing'
  returning * into v_plan;
  if v_plan is null then raise exception 'Publishing plan not found' using errcode = 'P0002'; end if;
  return v_plan;
end; $$;
