export function getSafeRedirectPath(value: string | null, fallback = "/today") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
}
