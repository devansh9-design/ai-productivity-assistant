-- Keep database plan state aligned with the external AI Planner publication.

alter table public.daily_plans
  drop constraint if exists daily_plans_status_check;

alter table public.daily_plans
  add constraint daily_plans_status_check
  check (status in ('draft', 'publishing', 'publication_failed', 'confirmed', 'superseded', 'completed'));

create or replace function public.begin_daily_plan_publication(p_plan_id uuid)
returns public.daily_plans language plpgsql set search_path = '' as $$
declare v_plan public.daily_plans;
begin
  select * into v_plan from public.daily_plans
  where id = p_plan_id and user_id = (select auth.uid()) for update;
  if v_plan is null then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  if v_plan.status not in ('draft', 'publication_failed') then
    raise exception 'Only draft or failed plans can be published (current status: %)', v_plan.status using errcode = 'P0001';
  end if;
  update public.daily_plans set status = 'publishing', updated_at = now()
  where id = p_plan_id returning * into v_plan;
  return v_plan;
end; $$;

create or replace function public.fail_daily_plan_publication(p_plan_id uuid)
returns public.daily_plans language plpgsql set search_path = '' as $$
declare v_plan public.daily_plans;
begin
  update public.daily_plans set status = 'publication_failed', updated_at = now()
  where id = p_plan_id and user_id = (select auth.uid()) and status = 'publishing'
  returning * into v_plan;
  if v_plan is null then raise exception 'Publishing plan not found' using errcode = 'P0002'; end if;
  return v_plan;
end; $$;

create or replace function public.complete_daily_plan_publication(p_plan_id uuid)
returns public.daily_plans language plpgsql set search_path = '' as $$
declare v_plan public.daily_plans;
begin
  update public.daily_plans set status = 'confirmed', updated_at = now()
  where id = p_plan_id and user_id = (select auth.uid()) and status = 'publishing'
  returning * into v_plan;
  if v_plan is null then raise exception 'Publishing plan not found' using errcode = 'P0002'; end if;
  return v_plan;
end; $$;

grant execute on function public.begin_daily_plan_publication(uuid) to authenticated;
grant execute on function public.fail_daily_plan_publication(uuid) to authenticated;
grant execute on function public.complete_daily_plan_publication(uuid) to authenticated;
