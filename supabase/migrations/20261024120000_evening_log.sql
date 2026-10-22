-- Phase 2, Step 7: the evening log (student-planner-plan.md, Step 7).
--
-- One screen closes the day: each planned item is marked done, partly done or
-- skipped (with a reason), the day's metric numbers are entered, and a short
-- note, mood and lesson are kept. It replaces the evening check-in form; the
-- checkins and journal_entries tables keep holding mood, lesson and the note.
--
-- evening_log_items keeps what happened to each task on each day, including
-- "partly done", which tasks.status cannot say. Saving the log again edits the
-- same rows.
--
-- save_evening_log(p_date, p_items, p_metrics, p_evening) saves it all in one
-- transaction, as the caller (row-level security applies):
-- p_items:   [{"task_id", "outcome": "done" | "partial" | "skipped", "reason"}]
--            done     -> task completed.
--            skipped  -> task skipped with the reason (required).
--            partial  -> a routine session counts as held (completed, with
--                        "Partly done" as its reason); a one-off task stays
--                        open (todo) so it can be planned again.
--            Completing or skipping a task stops any timer still running on it.
--            Tasks not listed are left as they are.
-- p_metrics: [{"goal_metric_id", "value"}]; a null value removes that day's
--            reading, any other value replaces it.
-- p_evening: {"mood": 1-5 | null, "lesson": text | null, "note": text | null};
--            an empty note removes that day's journal entry.

create table if not exists public.evening_log_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  log_date date not null,
  outcome text not null check (outcome in ('done', 'partial', 'skipped')),
  reason text check (reason is null or char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evening_log_items_one_per_task_day unique (task_id, log_date),
  constraint evening_log_items_skip_has_reason check (outcome <> 'skipped' or reason is not null)
);

create index if not exists evening_log_items_user_date_idx on public.evening_log_items(user_id, log_date);

alter table public.evening_log_items enable row level security;
drop policy if exists "Users can view their own evening_log_items" on public.evening_log_items;
create policy "Users can view their own evening_log_items" on public.evening_log_items
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own evening_log_items" on public.evening_log_items;
create policy "Users can insert their own evening_log_items" on public.evening_log_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own evening_log_items" on public.evening_log_items;
create policy "Users can update their own evening_log_items" on public.evening_log_items
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own evening_log_items" on public.evening_log_items;
create policy "Users can delete their own evening_log_items" on public.evening_log_items
  for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.evening_log_items to authenticated;

drop trigger if exists evening_log_items_set_updated_at on public.evening_log_items;
create trigger evening_log_items_set_updated_at before update on public.evening_log_items
  for each row execute procedure public.set_updated_at();

-- The task must be the row owner's.
create or replace function public.check_evening_log_item_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id) then
    raise exception 'task_id % does not belong to user %', new.task_id, new.user_id using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_evening_log_item_owner() from public, anon, authenticated;

drop trigger if exists evening_log_items_check_owner on public.evening_log_items;
create trigger evening_log_items_check_owner before insert or update on public.evening_log_items
  for each row execute procedure public.check_evening_log_item_owner();

create or replace function public.save_evening_log(
  p_date date,
  p_items jsonb,
  p_metrics jsonb,
  p_evening jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
  v_metric jsonb;
  v_task_id uuid;
  v_outcome text;
  v_reason text;
  v_routine_id uuid;
  v_checkin_id uuid;
  v_note text;
  v_lesson text;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_date is null then
    raise exception 'A date is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_metrics, '[]'::jsonb)) <> 'array' then
    raise exception 'Items and metrics must be lists' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_task_id := (v_item->>'task_id')::uuid;
    v_outcome := v_item->>'outcome';
    v_reason := nullif(btrim(coalesce(v_item->>'reason', '')), '');

    select routine_id into v_routine_id from public.tasks where id = v_task_id and user_id = v_user;
    if not found then
      raise exception 'Task % not found', v_task_id using errcode = 'P0002';
    end if;
    if v_outcome = 'skipped' and v_reason is null then
      raise exception 'A reason is required to skip a task' using errcode = '22023';
    end if;

    insert into public.evening_log_items (user_id, task_id, log_date, outcome, reason)
    values (v_user, v_task_id, p_date, v_outcome, v_reason)
    on conflict (task_id, log_date) do update set outcome = excluded.outcome, reason = excluded.reason;

    if v_outcome = 'done' or v_outcome = 'skipped' or (v_outcome = 'partial' and v_routine_id is not null) then
      -- The work has ended: stop any timer still running on it.
      update public.task_sessions
      set ended_at = now(),
          minutes = round(extract(epoch from (now() - started_at)) / 60)::integer
      where task_id = v_task_id and user_id = v_user and ended_at is null;
    end if;

    update public.tasks
    set status = case
          when v_outcome = 'done' then 'completed'
          when v_outcome = 'skipped' then 'skipped'
          when v_routine_id is not null then 'completed'
          else 'todo'
        end,
        status_reason = case
          when v_outcome = 'done' then null
          when v_outcome = 'skipped' then v_reason
          else 'Partly done' || coalesce(': ' || v_reason, '.')
        end
    where id = v_task_id and user_id = v_user;
  end loop;

  for v_metric in select value from jsonb_array_elements(coalesce(p_metrics, '[]'::jsonb)) loop
    if v_metric->'value' is null or jsonb_typeof(v_metric->'value') = 'null' then
      delete from public.progress_logs
      where goal_metric_id = (v_metric->>'goal_metric_id')::uuid and log_date = p_date and user_id = v_user;
    else
      insert into public.progress_logs (user_id, goal_metric_id, log_date, value)
      values (v_user, (v_metric->>'goal_metric_id')::uuid, p_date, (v_metric->>'value')::numeric)
      on conflict (goal_metric_id, log_date) do update set value = excluded.value;
    end if;
  end loop;

  v_note := nullif(btrim(coalesce(p_evening->>'note', '')), '');
  v_lesson := nullif(btrim(coalesce(p_evening->>'lesson', '')), '');
  insert into public.checkins (user_id, checkin_date, type, mood, lesson)
  values (v_user, p_date, 'evening', nullif(p_evening->>'mood', '')::smallint, v_lesson)
  on conflict (user_id, checkin_date, type) do update set mood = excluded.mood, lesson = excluded.lesson
  returning id into v_checkin_id;

  if v_note is null then
    delete from public.journal_entries where user_id = v_user and entry_date = p_date;
  else
    insert into public.journal_entries (user_id, entry_date, checkin_id, reflection)
    values (v_user, p_date, v_checkin_id, v_note)
    on conflict (user_id, entry_date) do update set reflection = excluded.reflection, checkin_id = excluded.checkin_id;
  end if;
end;
$$;

revoke execute on function public.save_evening_log(date, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_evening_log(date, jsonb, jsonb, jsonb) to authenticated;
