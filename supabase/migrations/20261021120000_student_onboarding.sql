-- Phase 2, Step 2: student onboarding (student-planner-plan.md, Step 2).
--
-- 1. A "class" availability kind for the weekly college timetable. Every
--    kind other than working/high_focus is already treated as blocked time
--    by the scheduler, AI proposal checks and edit_draft_plan_block.
-- 2. New accounts no longer get the five starter goals (DSA, Full-stack,
--    Placements, College, Gym): onboarding offers them as choices instead.
-- 3. Accounts that already set up their week count as onboarded, so the
--    wizard never interrupts an existing user.
-- 4. complete_onboarding saves the wizard in one transaction.

alter table public.availability_rules drop constraint if exists availability_rules_kind_check;
alter table public.availability_rules add constraint availability_rules_kind_check
  check (kind in ('working', 'high_focus', 'sleep', 'meal', 'travel', 'break', 'exercise', 'class'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

update public.profiles p
set onboarded_at = now()
where p.onboarded_at is null
  and exists (select 1 from public.availability_rules ar where ar.user_id = p.id);

/**
 * Saves the onboarding wizard for the signed-in student, all or nothing.
 *
 * p_week replaces only the timetable kinds the wizard manages (class and
 * working); sleep, meals, gym and other rules from Settings are kept. Pass
 * null to leave the week unchanged (used when re-running onboarding for the
 * profile only). Each element: {"weekday": 0-6 (0 = Sunday), "kind":
 * "class" | "working", "start_time": "HH:MM", "end_time": "HH:MM"}.
 *
 * p_goals adds goals; it never deletes existing ones. Each element:
 * {"title", "category", "target_date" (optional), "weekly_hours" (optional)}.
 * start_date is today in the student's timezone.
 *
 * Runs as the caller (SECURITY INVOKER), so row-level security and every
 * table constraint still apply.
 */
create or replace function public.complete_onboarding(
  p_display_name text,
  p_college_year smallint,
  p_timezone text,
  p_week jsonb,
  p_goals jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_today date;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown timezone %', p_timezone using errcode = '22023';
  end if;
  if p_week is not null and jsonb_typeof(p_week) <> 'array' then
    raise exception 'Week must be a list' using errcode = '22023';
  end if;
  if p_goals is not null and (jsonb_typeof(p_goals) <> 'array' or jsonb_array_length(p_goals) > 10) then
    raise exception 'Goals must be a list of at most 10' using errcode = '22023';
  end if;
  v_today := (now() at time zone p_timezone)::date;

  update public.profiles
  set display_name = nullif(btrim(p_display_name), ''),
      college_year = p_college_year,
      timezone = p_timezone,
      onboarded_at = coalesce(onboarded_at, now())
  where id = v_user;

  if p_week is not null then
    if exists (
      select 1 from jsonb_array_elements(p_week) as item
      where coalesce(item->>'kind', '') not in ('class', 'working')
    ) then
      raise exception 'Onboarding can only set classes and study time' using errcode = '22023';
    end if;

    delete from public.availability_rules
    where user_id = v_user and kind in ('class', 'working');

    insert into public.availability_rules (user_id, weekday, kind, start_time, end_time)
    select v_user, (item->>'weekday')::smallint, item->>'kind', (item->>'start_time')::time, (item->>'end_time')::time
    from jsonb_array_elements(p_week) as item;
  end if;

  if p_goals is not null then
    insert into public.goals (user_id, title, category, start_date, target_date, weekly_hours)
    select v_user,
           btrim(item->>'title'),
           coalesce(item->>'category', 'other'),
           v_today,
           nullif(item->>'target_date', '')::date,
           nullif(item->>'weekly_hours', '')::numeric
    from jsonb_array_elements(p_goals) as item;
  end if;
end;
$$;

revoke execute on function public.complete_onboarding(text, smallint, text, jsonb, jsonb) from public, anon;
grant execute on function public.complete_onboarding(text, smallint, text, jsonb, jsonb) to authenticated;
