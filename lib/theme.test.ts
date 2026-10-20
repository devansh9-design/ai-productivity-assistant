import { describe, it, expect } from "vitest";
import { THEME_INIT_SCRIPT, isThemePreference } from "@/lib/theme";

/** Runs the <head> script against a fake browser and reports whether it chose dark. */
function runInit(stored: string | null, systemDark: boolean, storageThrows = false): boolean {
  const classes = new Set<string>();
  const window = { matchMedia: (query: string) => ({ matches: query.includes("dark") && systemDark }) };
  const localStorage = { getItem: () => { if (storageThrows) throw new Error("blocked"); return stored; } };
  const document = { documentElement: { classList: { toggle: (name: string, on: boolean) => { if (on) classes.add(name); else classes.delete(name); } } } };
  new Function("window", "localStorage", "document", THEME_INIT_SCRIPT)(window, localStorage, document);
  return classes.has("dark");
}

describe("THEME_INIT_SCRIPT", () => {
  it("uses the saved choice over the device setting", () => {
    expect(runInit("dark", false)).toBe(true);
    expect(runInit("light", true)).toBe(false);
  });

  it("follows the device when nothing valid is saved", () => {
    expect(runInit(null, true)).toBe(true);
    expect(runInit(null, false)).toBe(false);
    expect(runInit("purple", true)).toBe(true);
  });

  it("never breaks the page when storage is blocked", () => {
    expect(() => runInit(null, true, true)).not.toThrow();
  });
});

describe("isThemePreference", () => {
  it("accepts only the three choices", () => {
    expect(["light", "dark", "system"].every(isThemePreference)).toBe(true);
    expect(isThemePreference("auto")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});
