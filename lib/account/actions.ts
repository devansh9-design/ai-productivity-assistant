"use server";

import { requireUser } from "@/lib/auth/require-user";
import { confirmsAccountEmail } from "@/lib/account/confirm";
import { getValidAccessToken, revokeGoogleToken } from "@/lib/google/oauth";
import { errorFields, log } from "@/lib/log";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Deletes the signed-in user's account. Every user-owned table references
 * auth.users with ON DELETE CASCADE, so removing the auth user removes all of
 * their rows. Google access is revoked first, while the token still exists.
 */
export async function deleteAccount(formData: FormData): Promise<{ error: string } | { ok: true }> {
  const { supabase, user } = await requireUser();
  if (!confirmsAccountEmail(formData.get("confirm_email"), user.email)) {
    return { error: "Type your account email exactly to confirm." };
  }

  try {
    const tokenResult = await getValidAccessToken(user.id);
    if ("token" in tokenResult) await revokeGoogleToken(tokenResult.token);
  } catch (error) {
    // Best-effort: the stored credentials are deleted with the account either way.
    log("warn", "account.delete.google_revoke_failed", { userId: user.id, ...errorFields(error) });
  }

  const { error } = await createServiceRoleClient().auth.admin.deleteUser(user.id);
  if (error) {
    log("error", "account.delete.failed", { userId: user.id, ...errorFields(error) });
    return { error: "Your account could not be deleted. Nothing was removed. Please try again." };
  }
  log("info", "account.deleted", { userId: user.id });

  // Clears the session cookies; the server-side session is already gone with the user.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  return { ok: true };
}
