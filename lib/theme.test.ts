import { describe, it, expect } from "vitest";
import { SIDEBAR_COLLAPSED_CLASS, SIDEBAR_STORAGE_KEY, THEME_INIT_SCRIPT, THEME_STORAGE_KEY, isThemePreference } from "@/lib/theme";

/** Runs the <head> script against a fake browser and returns the classes it set on <html>. */
function runInit(stored: Record<string, string | null>, systemDark: boolean, storageThrows = false): Set<string> {
  const classes = new Set<string>();
  const window = { matchMedia: (query: string) => ({ matches: query.includes("dark") && systemDark }) };
  const localStorage = { getItem: (key: string) => { if (storageThrows) throw new Error("blocked"); return stored[key] ?? null; } };
  const document = { documentElement: { classList: { toggle: (name: string, on: boolean) => { if (on) classes.add(name); else classes.delete(name); } } } };
  new Function("window", "localStorage", "document", THEME_INIT_SCRIPT)(window, localStorage, document);
  return classes;
}

const theme = (value: string | null) => ({ [THEME_STORAGE_KEY]: value });

describe("THEME_INIT_SCRIPT", () => {
  it("uses the saved theme over the device setting", () => {
    expect(runInit(theme("dark"), false).has("dark")).toBe(true);
    expect(runInit(theme("light"), true).has("dark")).toBe(false);
  });

  it("follows the device when no valid theme is saved", () => {
    expect(runInit(theme(null), true).has("dark")).toBe(true);
    expect(runInit(theme(null), false).has("dark")).toBe(false);
    expect(runInit(theme("purple"), true).has("dark")).toBe(true);
  });

  it("restores a collapsed sidebar, and shows it by default", () => {
    expect(runInit({ [SIDEBAR_STORAGE_KEY]: "collapsed" }, false).has(SIDEBAR_COLLAPSED_CLASS)).toBe(true);
    expect(runInit({}, false).has(SIDEBAR_COLLAPSED_CLASS)).toBe(false);
    expect(runInit({ [SIDEBAR_STORAGE_KEY]: "open" }, false).has(SIDEBAR_COLLAPSED_CLASS)).toBe(false);
  });

  it("never breaks the page when storage is blocked", () => {
    expect(() => runInit({}, true, true)).not.toThrow();
  });
});

describe("isThemePreference", () => {
  it("accepts only the three choices", () => {
    expect(["light", "dark", "system"].every(isThemePreference)).toBe(true);
    expect(isThemePreference("auto")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});
