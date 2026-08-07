import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client using the service-role key.
 * This client bypasses RLS and must ONLY be used in server-side code
 * (Server Actions, Route Handlers) for operations on tables with no
 * authenticated-user policies (e.g. google_credentials).
 *
 * NEVER import this module from client components.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase service-role configuration. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local.",
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
