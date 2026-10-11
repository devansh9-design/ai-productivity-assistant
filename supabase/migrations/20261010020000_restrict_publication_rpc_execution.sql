-- PostgreSQL grants EXECUTE on newly created functions to PUBLIC by default.
-- These publication RPCs must only be callable by authenticated users; each
-- function additionally validates ownership via auth.uid().

revoke all on function public.begin_daily_plan_publication(uuid) from public, anon;
revoke all on function public.fail_daily_plan_publication(uuid) from public, anon;
revoke all on function public.complete_daily_plan_publication(uuid) from public, anon;

grant execute on function public.begin_daily_plan_publication(uuid) to authenticated;
grant execute on function public.fail_daily_plan_publication(uuid) to authenticated;
grant execute on function public.complete_daily_plan_publication(uuid) to authenticated;
