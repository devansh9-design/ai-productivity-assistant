-- Phase 1: allow the new secret-authenticated Next.js routes to invoke the
-- RPC before the public-key grant is removed in the next migration.
grant execute on function public.telegram_today(text, date) to service_role;

-- The check-in route now uses direct service-role upserts. Revoke every
-- existing overload safely, without assuming the old RPC's signature.
do $$
declare
  function_signature text;
begin
  for function_signature in
    select format('public.%I(%s)', procedure.proname, pg_get_function_identity_arguments(procedure.oid))
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'telegram_checkin'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', function_signature);
  end loop;
end;
$$;
