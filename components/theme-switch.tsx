"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { isThemePreference, THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

// One shared value for every switch on the page (the sidebar renders a
// mobile and a desktop copy), kept in localStorage and announced by event.
const CHANGE_EVENT = "theme-preference-change";

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange); // another tab changed it
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function savePreference(next: ThemePreference) {
  try {
    if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this visit.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function apply(preference: ThemePreference) {
  const dark = preference === "dark"
    || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Light / Dark / System. The choice is kept in this browser only (it is a
 * display preference, not account data); "System" follows the device and
 * updates live when the device switches.
 */
export function ThemeSwitch() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as const);

  useEffect(() => {
    apply(preference);
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => apply("system");
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [preference]);

  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = preference === value;
        return (
          <button key={value} type="button" role="radio" aria-checked={selected} onClick={() => savePreference(value)}
            className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${selected
              ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
              : "text-slate-500 hover:text-slate-900"}`}>
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
