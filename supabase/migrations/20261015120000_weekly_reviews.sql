-- Day 11: weekly review (looking back) and weekly plan (looking ahead).
--
-- A review belongs to the week it describes; a plan belongs to the week it
-- prepares. They are separate tables, so editing an older review can never
-- change the priorities chosen for an upcoming week.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  review_week_start date not null check (extract(isodow from review_week_start) = 1),
  summary_source text not null check (summary_source in ('ai', 'fallback')),
  summary_headline text not null check (char_length(summary_headline) between 1 and 200),
  summary_suggestion text check (summary_suggestion is null or char_length(summary_suggestion) <= 300),
  -- [{ "metric": "<approved key>", "note": "<text without digits>" }], validated by the app.
  observations jsonb not null default '[]'::jsonb check (jsonb_typeof(observations) = 'array'),
  fallback_reason text check (fallback_reason is null or char_length(fallback_reason) <= 300),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_reviews_one_per_week unique (user_id, review_week_start)
);

-- Highlights reference real tasks. Deleting a task removes its highlight, so
-- the page never shows a title for a task that no longer exists.
create table if not exists public.weekly_review_highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  weekly_review_id uuid not null references public.weekly_reviews(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  note text check (note is null or char_length(note) <= 300),
  constraint weekly_review_highlights_unique_task unique (weekly_review_id, task_id),
  constraint weekly_review_highlights_unique_position unique (weekly_review_id, position)
);

create table if not exists public.weekly_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  planning_week_start date not null check (extract(isodow from planning_week_start) = 1),
  review_week_start date check (review_week_start is null or extract(isodow from review_week_start) = 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_plans_one_per_week unique (user_id, planning_week_start)
);

-- The position ranges cap a plan at three priorities and seven shortlist
-- items; the unique constraints stop a task appearing twice in one plan.
create table if not exists public.weekly_plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  weekly_plan_id uuid not null references public.weekly_plans(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  kind text not null check (kind in ('priority', 'shortlist')),
  position smallint not null,
  constraint weekly_plan_items_position_range check (
    (kind = 'priority' and position between 1 and 3) or (kind = 'shortlist' and position between 1 and 7)
  ),
  constraint weekly_plan_items_unique_task unique (weekly_plan_id, task_id),
  constraint weekly_plan_items_unique_position unique (weekly_plan_id, kind, position)
);

create index if not exists weekly_review_highlights_task_id_idx on public.weekly_review_highlights(task_id);
create index if not exists weekly_plan_items_task_id_idx on public.weekly_plan_items(task_id);

-- ---------------------------------------------------------------------------
-- Row-level security, grants, updated_at
-- ---------------------------------------------------------------------------

alter table public.weekly_reviews enable row level security;
alter table public.weekly_review_highlights enable row level security;
alter table public.weekly_plans enable row level security;
alter table public.weekly_plan_items enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['weekly_reviews', 'weekly_review_highlights', 'weekly_plans', 'weekly_plan_items']
  loop
    execute format('drop policy if exists "Users can view their own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users can view their own %1$s" on public.%1$s for select to authenticated using ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists "Users can insert their own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users can insert their own %1$s" on public.%1$s for insert to authenticated with check ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists "Users can update their own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users can update their own %1$s" on public.%1$s for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists "Users can delete their own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users can delete their own %1$s" on public.%1$s for delete to authenticated using ((select auth.uid()) = user_id)', table_name);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', table_name);
  end loop;
end;
$$;

drop trigger if exists weekly_reviews_set_updated_at on public.weekly_reviews;
create trigger weekly_reviews_set_updated_at before update on public.weekly_reviews
  for each row execute procedure public.set_updated_at();
drop trigger if exists weekly_plans_set_updated_at on public.weekly_plans;
create trigger weekly_plans_set_updated_at before update on public.weekly_plans
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Cross-user reference checks (same pattern as plan_blocks)
-- ---------------------------------------------------------------------------

create or replace function public.check_weekly_review_highlight_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.weekly_reviews r where r.id = new.weekly_review_id and r.user_id = new.user_id) then
    raise exception 'weekly_review_id % does not belong to user %', new.weekly_review_id, new.user_id using errcode = '23503';
  end if;
  if not exists (select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id) then
    raise exception 'task_id % does not belong to user %', new.task_id, new.user_id using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists weekly_review_highlights_check_owner on public.weekly_review_highlights;
create trigger weekly_review_highlights_check_owner before insert or update on public.weekly_review_highlights
  for each row execute procedure public.check_weekly_review_highlight_owner();

create or replace function public.check_weekly_plan_item_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.weekly_plans p where p.id = new.weekly_plan_id and p.user_id = new.user_id) then
    raise exception 'weekly_plan_id % does not belong to user %', new.weekly_plan_id, new.user_id using errcode = '23503';
  end if;
  if not exists (select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id) then
    raise exception 'task_id % does not belong to user %', new.task_id, new.user_id using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists weekly_plan_items_check_owner on public.weekly_plan_items;
create trigger weekly_plan_items_check_owner before insert or update on public.weekly_plan_items
  for each row execute procedure public.check_weekly_plan_item_owner();

-- ---------------------------------------------------------------------------
-- Atomic saves. Both run as the calling user (row-level security applies) in
-- a single transaction: any failure rolls back every row, including tasks
-- created from typed titles.
-- ---------------------------------------------------------------------------

-- p_priorities: up to 3 of {"task_id": "<uuid>"} or {"new_title": "<text>"}, in order.
-- p_shortlist:  up to 7 of {"task_id": "<uuid>"}, in order.
create or replace function public.save_weekly_plan(
  p_planning_week_start date,
  p_review_week_start date,
  p_priorities jsonb,
  p_shortlist jsonb
)
returns public.weekly_plans
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_plan public.weekly_plans;
  v_item jsonb;
  v_position integer;
  v_task_id uuid;
  v_title text;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_priorities, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_shortlist, '[]'::jsonb)) <> 'array' then
    raise exception 'Priorities and shortlist must be arrays' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_priorities, '[]'::jsonb)) > 3 then
    raise exception 'Choose at most three priorities' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_shortlist, '[]'::jsonb)) > 7 then
    raise exception 'Choose at most seven shortlist tasks' using errcode = '22023';
  end if;

  insert into public.weekly_plans (user_id, planning_week_start, review_week_start)
  values (v_user, p_planning_week_start, p_review_week_start)
  on conflict (user_id, planning_week_start) do update
    set review_week_start = excluded.review_week_start, updated_at = now()
  returning * into v_plan;

  delete from public.weekly_plan_items where weekly_plan_id = v_plan.id;

  for v_item, v_position in
    select value, ordinality from jsonb_array_elements(coalesce(p_priorities, '[]'::jsonb)) with ordinality
  loop
    if v_item ? 'new_title' then
      v_title := btrim(v_item->>'new_title');
      if char_length(coalesce(v_title, '')) not between 1 and 200 then
        raise exception 'A new priority task needs a title of 1 to 200 characters' using errcode = '22023';
      end if;
      insert into public.tasks (user_id, title) values (v_user, v_title) returning id into v_task_id;
    else
      v_task_id := (v_item->>'task_id')::uuid;
    end if;
    insert into public.weekly_plan_items (user_id, weekly_plan_id, task_id, kind, position)
    values (v_user, v_plan.id, v_task_id, 'priority', v_position);
  end loop;

  for v_item, v_position in
    select value, ordinality from jsonb_array_elements(coalesce(p_shortlist, '[]'::jsonb)) with ordinality
  loop
    insert into public.weekly_plan_items (user_id, weekly_plan_id, task_id, kind, position)
    values (v_user, v_plan.id, (v_item->>'task_id')::uuid, 'shortlist', v_position);
  end loop;

  return v_plan;
end;
$$;

-- p_observations: [{"metric": "...", "note": "..."}]; p_highlights: up to 3 of {"task_id": "<uuid>", "note": "<text>"}.
create or replace function public.save_weekly_review_summary(
  p_review_week_start date,
  p_source text,
  p_headline text,
  p_suggestion text,
  p_observations jsonb,
  p_fallback_reason text,
  p_highlights jsonb
)
returns public.weekly_reviews
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_review public.weekly_reviews;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into public.weekly_reviews
    (user_id, review_week_start, summary_source, summary_headline, summary_suggestion, observations, fallback_reason, generated_at)
  values
    (v_user, p_review_week_start, p_source, p_headline, p_suggestion, coalesce(p_observations, '[]'::jsonb), p_fallback_reason, now())
  on conflict (user_id, review_week_start) do update
    set summary_source = excluded.summary_source,
        summary_headline = excluded.summary_headline,
        summary_suggestion = excluded.summary_suggestion,
        observations = excluded.observations,
        fallback_reason = excluded.fallback_reason,
        generated_at = now(),
        updated_at = now()
  returning * into v_review;

  delete from public.weekly_review_highlights where weekly_review_id = v_review.id;

  insert into public.weekly_review_highlights (user_id, weekly_review_id, task_id, position, note)
  select v_user, v_review.id, (item.value->>'task_id')::uuid, item.ordinality, nullif(item.value->>'note', '')
  from jsonb_array_elements(coalesce(p_highlights, '[]'::jsonb)) with ordinality as item(value, ordinality);

  return v_review;
end;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC by default; only signed-in users may call these.
revoke all on function public.save_weekly_plan(date, date, jsonb, jsonb) from public, anon;
revoke all on function public.save_weekly_review_summary(date, text, text, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.save_weekly_plan(date, date, jsonb, jsonb) to authenticated;
grant execute on function public.save_weekly_review_summary(date, text, text, text, jsonb, text, jsonb) to authenticated;
