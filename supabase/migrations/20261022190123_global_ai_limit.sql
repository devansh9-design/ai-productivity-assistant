-- Phase 2, Step 12: a daily AI cap shared by all users, on top of the
-- per-user limits, so one heavy user (or many) can't use up the app's shared
-- Gemini free quota. The shared day follows Gemini's own quota day, which
-- resets at midnight Pacific time.
--
-- claim_ai_request(int, int) from 20261019120000 stays until the code that
-- calls it is gone from production; a later cleanup drops it.

create index if not exists ai_request_log_created_idx on public.ai_request_log (created_at);

/**
 * Claims one AI request for the signed-in user if the per-minute, per-day
 * and shared daily limits all allow it. Returns {"retry_after": 0} when
 * claimed, otherwise the whole seconds until a slot frees up and which limit
 * was hit ("minute", "day" or "global").
 *
 * Security definer only so the shared count can see every user's rows; it
 * reads counts and inserts a row for auth.uid() alone, and returns no rows.
 * One global advisory lock keeps concurrent claims from overshooting a cap.
 */
create or replace function public.claim_ai_request(p_per_minute integer, p_per_day integer, p_global_per_day integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
  v_oldest timestamptz;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_per_minute < 1 or p_per_day < 1 or p_global_per_day < 1 then
    raise exception 'Limits must be positive' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_request:global', 0));

  select count(*), min(created_at) into v_count, v_oldest
    from public.ai_request_log
    where user_id = v_user and created_at > now() - interval '1 minute';
  if v_count >= p_per_minute then
    return jsonb_build_object('retry_after', greatest(1, ceil(extract(epoch from (v_oldest + interval '1 minute' - now())))::integer), 'scope', 'minute');
  end if;

  select count(*), min(created_at) into v_count, v_oldest
    from public.ai_request_log
    where user_id = v_user and created_at > now() - interval '1 day';
  if v_count >= p_per_day then
    return jsonb_build_object('retry_after', greatest(1, ceil(extract(epoch from (v_oldest + interval '1 day' - now())))::integer), 'scope', 'day');
  end if;

  select count(*) into v_count
    from public.ai_request_log
    where created_at >= v_day_start;
  if v_count >= p_global_per_day then
    return jsonb_build_object('retry_after', greatest(1, ceil(extract(epoch from (v_day_start + interval '1 day' - now())))::integer), 'scope', 'global');
  end if;

  insert into public.ai_request_log (user_id) values (v_user);
  return jsonb_build_object('retry_after', 0);
end;
$$;

revoke execute on function public.claim_ai_request(integer, integer, integer) from public, anon;
grant execute on function public.claim_ai_request(integer, integer, integer) to authenticated;
