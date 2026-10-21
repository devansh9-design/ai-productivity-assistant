-- Phase 2, Step 5: routines become daily tasks (student-planner-plan.md, Step 5).
--
-- materialize_routine_tasks(p_date) runs whenever the student opens Today or
-- Tasks or plans their day. For the signed-in student it:
--   1. creates one task for each active routine that falls on p_date (ISO
--      weekday in days_of_week, p_date within the routine's dates, goal
--      active). The unique (routine_id, occurrence_date) index makes this
--      safe to run any number of times, from any number of tabs.
--   2. marks routine tasks from earlier days that were never done (still
--      todo or deferred, and not moved to p_date or later) as skipped, so a
--      missed session doesn't keep coming back in later plans.
-- Tasks are only ever created for the day asked for, never ahead, so editing
-- a routine changes the days that haven't been created yet.
-- Returns the number of tasks created.

create or replace function public.materialize_routine_tasks(p_date date)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_created integer;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_date is null then
    raise exception 'A date is required' using errcode = '22023';
  end if;

  insert into public.tasks (user_id, goal_id, routine_id, occurrence_date, title, description, category,
                            status, priority, estimated_minutes, energy_level, due_date)
  select v_user, r.goal_id, r.id, p_date, r.title, 'From your routine' || coalesce(' for ' || g.title, '') || '.', g.category,
         'todo', r.priority, r.minutes, r.energy_level, p_date
  from public.routines r
  left join public.goals g on g.id = r.goal_id
  where r.user_id = v_user
    and r.active
    and extract(isodow from p_date)::smallint = any (r.days_of_week)
    and p_date >= r.start_date
    and (r.end_date is null or p_date <= r.end_date)
    and (r.goal_id is null or g.status = 'active')
  on conflict (routine_id, occurrence_date) where routine_id is not null do nothing;
  get diagnostics v_created = row_count;

  update public.tasks
  set status = 'skipped',
      status_reason = 'Missed: the routine''s day passed without it being done.'
  where user_id = v_user
    and routine_id is not null
    and occurrence_date < p_date
    and status in ('todo', 'deferred')
    and (due_date is null or due_date < p_date);

  return v_created;
end;
$$;

revoke execute on function public.materialize_routine_tasks(date) from public, anon;
grant execute on function public.materialize_routine_tasks(date) to authenticated;
