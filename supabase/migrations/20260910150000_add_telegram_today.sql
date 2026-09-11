create or replace function public.telegram_today(
  p_chat_id text,
  p_plan_date date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_plan public.daily_plans%rowtype;
  v_blocks jsonb;
  v_unscheduled jsonb;
begin
  select user_id into v_user_id
  from public.telegram_chat_mappings
  where chat_id = trim(p_chat_id)
  limit 1;

  if v_user_id is null then
    raise exception 'Telegram chat is not linked';
  end if;

  select * into v_plan
  from public.daily_plans
  where user_id = v_user_id
    and plan_date = p_plan_date
    and status <> 'superseded'
  order by
    case when status = 'confirmed' then 0 when status = 'draft' then 1 else 2 end,
    version desc,
    generated_at desc
  limit 1;

  if v_plan.id is null then
    return jsonb_build_object(
      'ok', true,
      'plan_date', p_plan_date,
      'plan', null,
      'blocks', '[]'::jsonb,
      'unscheduled', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', pb.id,
      'kind', pb.kind,
      'title', pb.title,
      'start_time', pb.start_time,
      'end_time', pb.end_time,
      'task_id', pb.task_id,
      'is_manual', pb.is_manual,
      'sort_order', pb.sort_order
    ) order by pb.sort_order, pb.start_time
  ), '[]'::jsonb)
  into v_blocks
  from public.plan_blocks pb
  where pb.daily_plan_id = v_plan.id
    and pb.user_id = v_user_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'task_id', put.task_id,
      'reason', put.reason,
      'title', t.title,
      'priority', t.priority,
      'estimated_minutes', t.estimated_minutes,
      'due_date', t.due_date
    ) order by t.priority, t.due_date nulls last, t.title
  ), '[]'::jsonb)
  into v_unscheduled
  from public.plan_unscheduled_tasks put
  join public.tasks t on t.id = put.task_id and t.user_id = v_user_id
  where put.daily_plan_id = v_plan.id
    and put.user_id = v_user_id;

  return jsonb_build_object(
    'ok', true,
    'plan_date', p_plan_date,
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'status', v_plan.status,
      'version', v_plan.version,
      'buffer_minutes', v_plan.buffer_minutes,
      'generated_at', v_plan.generated_at
    ),
    'blocks', v_blocks,
    'unscheduled', v_unscheduled
  );
end;
$function$;

revoke all on function public.telegram_today(text, date) from public;
grant execute on function public.telegram_today(text, date) to anon;