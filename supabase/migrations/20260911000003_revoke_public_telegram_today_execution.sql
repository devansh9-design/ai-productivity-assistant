-- Phase 2: apply only after the Vercel deployment containing the
-- service-role Telegram today/plan/command routes is live and verified.
revoke all on function public.telegram_today(text, date) from public, anon, authenticated;
grant execute on function public.telegram_today(text, date) to service_role;
