-- Day 13: security hardening.
--
-- 1. Function grants. PostgreSQL grants EXECUTE to PUBLIC on every new
--    function, which exposes it at /rest/v1/rpc/<name> to signed-out (anon)
--    callers too. The app's RPCs are SECURITY INVOKER, so RLS already stops
--    anon from touching any row, but they are still callable. Only signed-in
--    users (and the server's service role) need them.
--    Trigger functions are never called directly: EXECUTE is checked only when
--    a trigger is created, not when it fires, so revoking it from every API
--    role leaves the triggers working and removes them from the RPC surface.
-- 2. Two older updated_at trigger functions get a fixed, empty search_path
--    (Supabase advisor: function_search_path_mutable).
-- 3. ai_request_log + claim_ai_request: a per-user rate limit for the AI chat
--    endpoint, claimed before every Gemini call so failed calls count too.
--
-- Functions are looked up by name, so the migration applies to a clean
-- database built from this repository and to the deployed one alike.

do $$
declare
  f regprocedure;
begin
  -- RPCs the app calls as the signed-in user.
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'begin_daily_plan_publication', 'complete_daily_plan_publication', 'fail_daily_plan_publication',
      'confirm_daily_plan', 'create_draft_plan', 'replace_daily_plan',
      'delete_draft_plan_block', 'edit_draft_plan_block', 'stop_task_session',
      'save_weekly_plan', 'save_weekly_review_summary'
    ])
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;

  -- Trigger functions: no API role needs to call them.
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;

  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('set_ai_conversations_updated_at', 'set_telegram_chat_mappings_updated_at')
  loop
    execute format('alter function %s set search_path = %L', f, '');
  end loop;
end;
$$;

-- AI chat rate limit. Rows are only ever added: users can read and insert
-- their own, but cannot update or delete them to reset the limit.
create table if not exists public.ai_request_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists ai_request_log_user_created_idx on public.ai_request_log (user_id, created_at desc);

alter table public.ai_request_log enable row level security;

drop policy if exists "Users can view their own AI requests" on public.ai_request_log;
create policy "Users can view their own AI requests"
  on public.ai_request_log for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can log their own AI requests" on public.ai_request_log;
create policy "Users can log their own AI requests"
  on public.ai_request_log for insert to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert on public.ai_request_log to authenticated;

/**
 * Claims one AI request for the signed-in user if both limits allow it.
 * Returns 0 when claimed, otherwise the whole seconds until a slot frees up.
 * A per-user advisory lock makes concurrent claims count correctly.
 */
create or replace function public.claim_ai_request(p_per_minute integer, p_per_day integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
  v_oldest timestamptz;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_per_minute < 1 or p_per_day < 1 then
    raise exception 'Limits must be positive' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_request:' || v_user::text, 0));

  select count(*), min(created_at) into v_count, v_oldest
    from public.ai_request_log
    where user_id = v_user and created_at > now() - interval '1 minute';
  if v_count >= p_per_minute then
    return greatest(1, ceil(extract(epoch from (v_oldest + interval '1 minute' - now())))::integer);
  end if;

  select count(*), min(created_at) into v_count, v_oldest
    from public.ai_request_log
    where user_id = v_user and created_at > now() - interval '1 day';
  if v_count >= p_per_day then
    return greatest(1, ceil(extract(epoch from (v_oldest + interval '1 day' - now())))::integer);
  end if;

  insert into public.ai_request_log (user_id) values (v_user);
  return 0;
end;
$$;

revoke execute on function public.claim_ai_request(integer, integer) from public, anon;
grant execute on function public.claim_ai_request(integer, integer) to authenticated;
