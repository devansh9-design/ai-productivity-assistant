/** Deleting an account needs the account's own email typed back, ignoring case and outer spaces. */
export function confirmsAccountEmail(typed: unknown, accountEmail: string | undefined): boolean {
  if (typeof typed !== "string" || !accountEmail) return false;
  return typed.trim().toLowerCase() === accountEmail.trim().toLowerCase();
}
