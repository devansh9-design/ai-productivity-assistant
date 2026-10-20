export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "theme";
export const THEME_PREFERENCES: ThemePreference[] = ["light", "dark", "system"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Desktop sidebar: stored as "collapsed" when the user hid it; anything else means shown. */
export const SIDEBAR_STORAGE_KEY = "sidebar";
export const SIDEBAR_COLLAPSED_CLASS = "sidebar-collapsed";

/**
 * Runs in <head> before the page paints, so a dark-theme user never sees a
 * flash of the light theme and a hidden sidebar never flashes open. Kept tiny
 * and self-contained: it cannot import anything. A missing, unknown or
 * unreadable theme means "system"; a missing sidebar choice means shown.
 */
export const THEME_INIT_SCRIPT = `(function(){var c=document.documentElement.classList;try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||((t!=="light")&&window.matchMedia("(prefers-color-scheme: dark)").matches);c.toggle("dark",d);}catch(e){}try{c.toggle("${SIDEBAR_COLLAPSED_CLASS}",localStorage.getItem("${SIDEBAR_STORAGE_KEY}")==="collapsed");}catch(e){}})();`;
