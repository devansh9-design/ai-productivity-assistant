-- Day 3 (part 2): evening check-ins and journal reflections.
--
-- checkins holds the structured signals (mood, energy, distractions, wins,
-- lesson) for a given day. journal_entries holds the free-text reflection
-- separately, optionally linked back to the checkin it was written
-- alongside -- kept as its own table (rather than a column on checkins) so
-- future journaling that isn't tied to an evening check-in has somewhere to
-- live without reshaping this schema.
--
-- Each is unique per (user_id, date[, type]) so "save the evening check-in"
-- is naturally an upsert: writing today's reflection twice edits the same
-- row instead of creating duplicates.

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  checkin_date date not null default current_date,
  type text not null default 'evening' check (type in ('morning', 'evening')),
  mood smallint check (mood is null or mood between 1 and 5),
  energy_level text check (energy_level is null or energy_level in ('low', 'medium', 'high')),
  distractions text check (distractions is null or char_length(distractions) <= 2000),
  wins text check (wins is null or char_length(wins) <= 2000),
  lesson text check (lesson is null or char_length(lesson) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkins_unique_per_day_and_type unique (user_id, checkin_date, type)
);

alter table public.checkins enable row level security;

drop policy if exists "Users can view their own checkins" on public.checkins;
create policy "Users can view their own checkins"
  on public.checkins for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own checkins" on public.checkins;
create policy "Users can insert their own checkins"
  on public.checkins for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own checkins" on public.checkins;
create policy "Users can update their own checkins"
  on public.checkins for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own checkins" on public.checkins;
create policy "Users can delete their own checkins"
  on public.checkins for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists checkins_user_id_idx on public.checkins(user_id);
create index if not exists checkins_checkin_date_idx on public.checkins(checkin_date);

drop trigger if exists checkins_set_updated_at on public.checkins;
create trigger checkins_set_updated_at
  before update on public.checkins
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  checkin_id uuid references public.checkins(id) on delete set null,
  reflection text not null check (char_length(reflection) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_entries_unique_per_day unique (user_id, entry_date)
);

alter table public.journal_entries enable row level security;

drop policy if exists "Users can view their own journal entries" on public.journal_entries;
create policy "Users can view their own journal entries"
  on public.journal_entries for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own journal entries" on public.journal_entries;
create policy "Users can insert their own journal entries"
  on public.journal_entries for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own journal entries" on public.journal_entries;
create policy "Users can update their own journal entries"
  on public.journal_entries for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own journal entries" on public.journal_entries;
create policy "Users can delete their own journal entries"
  on public.journal_entries for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists journal_entries_user_id_idx on public.journal_entries(user_id);
create index if not exists journal_entries_entry_date_idx on public.journal_entries(entry_date);
create index if not exists journal_entries_checkin_id_idx on public.journal_entries(checkin_id);

drop trigger if exists journal_entries_set_updated_at on public.journal_entries;
create trigger journal_entries_set_updated_at
  before update on public.journal_entries
  for each row execute procedure public.set_updated_at();

-- Cross-user FK validation, matching the pattern established in
-- 20260731000002_cross_user_fk_validation.sql: journal_entries.checkin_id
-- must point at a checkin owned by the same user.
create or replace function public.check_journal_entry_checkin_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.checkin_id is not null and not exists (
    select 1 from public.checkins c where c.id = new.checkin_id and c.user_id = new.user_id
  ) then
    raise exception 'checkin_id % does not belong to user %', new.checkin_id, new.user_id
      using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists journal_entries_check_checkin_owner on public.journal_entries;
create trigger journal_entries_check_checkin_owner
  before insert or update on public.journal_entries
  for each row execute procedure public.check_journal_entry_checkin_owner();

grant select, insert, update, delete on public.checkins to authenticated;
grant select, insert, update, delete on public.journal_entries to authenticated;

-- ---------------------------------------------------------------------
-- Task-session timer (optional, per Day 3 task 7). started_at/user_id/
-- task_id already exist on task_sessions from the Day 2 migration; a
-- session is "active" while ended_at is null. Stopping computes elapsed
-- minutes server-side (via now() - started_at) rather than trusting a
-- client-supplied duration, so a stale browser tab or clock skew can't
-- record the wrong amount of time.
create or replace function public.stop_task_session(p_task_session_id uuid)
returns public.task_sessions
language plpgsql
set search_path = ''
as $$
declare
  updated_row public.task_sessions;
begin
  update public.task_sessions
  set ended_at = now(),
      minutes = round(extract(epoch from (now() - started_at)) / 60)::integer
  where id = p_task_session_id
    and user_id = (select auth.uid())
    and ended_at is null
  returning * into updated_row;

  if updated_row.id is null then
    raise exception 'Task session not found, not yours, or already stopped';
  end if;

  return updated_row;
end;
$$;

grant execute on function public.stop_task_session(uuid) to authenticated;
