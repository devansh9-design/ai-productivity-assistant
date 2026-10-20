-- Day 13 database behaviour tests for function grants and the AI rate limit.
--
-- Runs in CI after every migration has been applied to a throwaway Postgres
-- (see .github/workflows/migrations-clean-db.yml). It replaces the CI stub's
-- auth.uid() so it can act as two different signed-in users; never run it
-- against a real Supabase project. Fails if any check fails.
-- Test harness only: let auth.uid() read a session setting.
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
insert into auth.users (id, email) values
  ('eeeeeeee-0000-4000-8000-000000000005', 'e@test'),
  ('ffffffff-0000-4000-8000-000000000006', 'f@test')
on conflict (id) do nothing;

create temp table hardening_results (name text, ok boolean, detail text);
grant all on hardening_results to authenticated, anon;

-- 1. Grants: signed-out callers cannot call the app's RPCs; nobody calls trigger functions.
insert into hardening_results select 'anon cannot call create_draft_plan',
  not has_function_privilege('anon', 'public.create_draft_plan'::regproc, 'execute'), '';
insert into hardening_results select 'anon cannot call claim_ai_request',
  not has_function_privilege('anon', 'public.claim_ai_request(integer, integer)', 'execute'), '';
insert into hardening_results select 'signed-in users can call create_draft_plan',
  has_function_privilege('authenticated', 'public.create_draft_plan'::regproc, 'execute'), '';
insert into hardening_results select 'no API role can call a trigger function',
  (select bool_and(not has_function_privilege(r, p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon', 'authenticated']) r
   where n.nspname = 'public' and p.prorettype = 'trigger'::regtype), '';
insert into hardening_results select 'updated_at trigger functions have a fixed search_path',
  (select bool_and(p.proconfig @> array['search_path=""'])
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_ai_conversations_updated_at', 'set_telegram_chat_mappings_updated_at')), '';

set role authenticated;
set test.uid = 'eeeeeeee-0000-4000-8000-000000000005';

-- 2. Triggers still fire for a signed-in user after the revoke.
insert into public.integration_status (provider) values ('google_calendar');
update public.integration_status set planning_enabled = false;
insert into hardening_results select 'updated_at trigger still runs for signed-in writes',
  (select updated_at > created_at from public.integration_status), '';

-- 3. The per-minute limit: two claims succeed, the third waits.
insert into hardening_results select 'first claim allowed', public.claim_ai_request(2, 100) = 0, '';
insert into hardening_results select 'second claim allowed', public.claim_ai_request(2, 100) = 0, '';
do $$ declare wait integer := public.claim_ai_request(2, 100); begin
  insert into hardening_results values ('third claim within a minute waits', wait between 1 and 60, wait || ' seconds');
end $$;
insert into hardening_results select 'a refused claim is not logged',
  (select count(*) = 2 from public.ai_request_log), '';

-- 4. The per-day limit applies even when the minute limit allows it.
do $$ declare wait integer := public.claim_ai_request(100, 2); begin
  insert into hardening_results values ('daily limit waits', wait > 60, wait || ' seconds');
end $$;

-- 5. Users cannot reset their own limit.
do $$ declare removed bigint; begin
  delete from public.ai_request_log;
  get diagnostics removed = row_count;
  insert into hardening_results values ('user cannot delete their AI request log', removed = 0, removed || ' rows deleted');
exception when insufficient_privilege then insert into hardening_results values ('user cannot delete their AI request log', true, sqlerrm); end $$;

-- 6. Another user sees none of E's requests and has their own allowance.
set test.uid = 'ffffffff-0000-4000-8000-000000000006';
insert into hardening_results select 'user F cannot see E''s AI requests', (select count(*) = 0 from public.ai_request_log), '';
insert into hardening_results select 'user F has their own allowance', public.claim_ai_request(2, 100) = 0, '';
do $$ begin
  insert into public.ai_request_log (user_id) values ('eeeeeeee-0000-4000-8000-000000000005');
  insert into hardening_results values ('user F cannot log a request as E', false, 'no error');
exception when insufficient_privilege then insert into hardening_results values ('user F cannot log a request as E', true, sqlerrm); end $$;

-- 7. Signed-out callers see no AI requests.
reset role;
set role anon;
set test.uid = '';
do $$ declare visible bigint; begin
  select count(*) into visible from public.ai_request_log;
  insert into hardening_results values ('anon sees no AI requests', visible = 0, visible || ' rows visible');
exception when insufficient_privilege then insert into hardening_results values ('anon sees no AI requests', true, sqlerrm); end $$;
reset role;

select (case when ok then 'PASS' else 'FAIL' end) || '  ' || name || case when ok or detail = '' then '' else '  [' || detail || ']' end from hardening_results;

do $$ begin
  if exists (select 1 from hardening_results where not ok) then
    raise exception 'Security hardening database tests failed';
  end if;
end $$;
