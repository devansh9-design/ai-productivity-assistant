-- Phase 2, Step 4: save an AI-drafted (and student-edited) roadmap in one go.
--
-- The app validates the draft with the same rules as the manual builder
-- (lib/goals/roadmap.ts) before calling this; table constraints and the
-- ownership triggers still check every row here. Runs as the caller, so
-- row-level security applies.
--
-- p_goal:     {"start_date", "target_date", "weekly_hours", "level"}; the goal is
--             updated with these and marked plan_source = 'ai'.
-- p_metrics:  [{"name", "unit", "aggregation", "baseline_value", "target_value"}].
--             A metric whose name the goal already tracks (ignoring case) is reused.
-- p_phases:   [{"title", "focus", "start_date", "end_date", "target_note"}].
-- p_targets:  [{"week_start", "title", "metric_name", "target_value"}].
-- p_routines: [{"title", "days_of_week": [1-7], "minutes", "preferred_start",
--               "preferred_end", "priority", "metric_name", "metric_amount",
--               "start_date", "end_date"}].
--             metric_name refers to a metric of this goal, existing or new.
-- p_replace:  true removes the goal's current phases, weekly targets and
--             routines first (tasks they created are kept, as history).
-- A null section is left untouched.

create or replace function public.save_goal_roadmap(
  p_goal_id uuid,
  p_goal jsonb,
  p_metrics jsonb,
  p_phases jsonb,
  p_targets jsonb,
  p_routines jsonb,
  p_replace boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_next_position integer;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if not exists (select 1 from public.goals where id = p_goal_id and user_id = v_user) then
    raise exception 'Goal not found' using errcode = 'P0002';
  end if;
  if (p_metrics is not null and jsonb_typeof(p_metrics) <> 'array')
    or (p_phases is not null and jsonb_typeof(p_phases) <> 'array')
    or (p_targets is not null and jsonb_typeof(p_targets) <> 'array')
    or (p_routines is not null and jsonb_typeof(p_routines) <> 'array') then
    raise exception 'Each roadmap section must be a list' using errcode = '22023';
  end if;

  update public.goals
  set start_date = nullif(p_goal->>'start_date', '')::date,
      target_date = nullif(p_goal->>'target_date', '')::date,
      weekly_hours = nullif(p_goal->>'weekly_hours', '')::numeric,
      level = nullif(p_goal->>'level', ''),
      plan_source = 'ai'
  where id = p_goal_id and user_id = v_user;

  if p_replace then
    if p_phases is not null then delete from public.goal_phases where goal_id = p_goal_id; end if;
    if p_targets is not null then delete from public.weekly_targets where goal_id = p_goal_id; end if;
    if p_routines is not null then delete from public.routines where goal_id = p_goal_id; end if;
  end if;

  if p_metrics is not null then
    select coalesce(max(position), 0) into v_next_position from public.goal_metrics where goal_id = p_goal_id;
    insert into public.goal_metrics (user_id, goal_id, name, unit, aggregation, baseline_value, target_value, position)
    select v_user, p_goal_id, btrim(item->>'name'), nullif(btrim(item->>'unit'), ''),
           coalesce(item->>'aggregation', 'sum'),
           nullif(item->>'baseline_value', '')::numeric, nullif(item->>'target_value', '')::numeric,
           v_next_position + row_number() over ()
    from jsonb_array_elements(p_metrics) as item
    where not exists (
      select 1 from public.goal_metrics m where m.goal_id = p_goal_id and lower(m.name) = lower(btrim(item->>'name'))
    );
  end if;

  if p_phases is not null then
    select coalesce(max(position), 0) into v_next_position from public.goal_phases where goal_id = p_goal_id;
    insert into public.goal_phases (user_id, goal_id, position, title, focus, start_date, end_date, target_note)
    select v_user, p_goal_id, v_next_position + row_number() over (order by (item->>'start_date')::date),
           btrim(item->>'title'), nullif(btrim(item->>'focus'), ''),
           (item->>'start_date')::date, (item->>'end_date')::date, nullif(btrim(item->>'target_note'), '')
    from jsonb_array_elements(p_phases) as item;
  end if;

  if p_targets is not null then
    insert into public.weekly_targets (user_id, goal_id, week_start, title, goal_metric_id, target_value)
    select v_user, p_goal_id, (item->>'week_start')::date, btrim(item->>'title'),
           (select m.id from public.goal_metrics m where m.goal_id = p_goal_id and lower(m.name) = lower(btrim(item->>'metric_name'))),
           nullif(item->>'target_value', '')::numeric
    from jsonb_array_elements(p_targets) as item;
  end if;

  if p_routines is not null then
    insert into public.routines (user_id, goal_id, title, days_of_week, minutes, preferred_start, preferred_end, priority,
                                 goal_metric_id, metric_amount, start_date, end_date)
    select v_user, p_goal_id, btrim(item->>'title'),
           array(select jsonb_array_elements_text(item->'days_of_week')::smallint),
           (item->>'minutes')::integer,
           nullif(item->>'preferred_start', '')::time, nullif(item->>'preferred_end', '')::time,
           coalesce(item->>'priority', 'medium'),
           (select m.id from public.goal_metrics m where m.goal_id = p_goal_id and lower(m.name) = lower(btrim(item->>'metric_name'))),
           nullif(item->>'metric_amount', '')::numeric,
           (item->>'start_date')::date, nullif(item->>'end_date', '')::date
    from jsonb_array_elements(p_routines) as item;
  end if;
end;
$$;

revoke execute on function public.save_goal_roadmap(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.save_goal_roadmap(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) to authenticated;
