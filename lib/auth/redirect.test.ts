import { describe, expect, it } from "vitest";
import { getSafeRedirectPath } from "./redirect";

describe("getSafeRedirectPath", () => {
  it("uses an internal app path", () => {
    expect(getSafeRedirectPath("/today?date=2026-10-22")).toBe("/today?date=2026-10-22");
  });

  it("rejects external and protocol-relative paths", () => {
    expect(getSafeRedirectPath("https://attacker.example")).toBe("/today");
    expect(getSafeRedirectPath("//attacker.example")).toBe("/today");
    expect(getSafeRedirectPath(null, "/login")).toBe("/login");
  });
});
