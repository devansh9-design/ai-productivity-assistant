import { describe, expect, it } from "vitest";
import { confirmsAccountEmail } from "@/lib/account/confirm";

describe("confirmsAccountEmail", () => {
  it("accepts the account email in any case, with outer spaces", () => {
    expect(confirmsAccountEmail("  Student@Example.com ", "student@example.com")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(confirmsAccountEmail("student@example.co", "student@example.com")).toBe(false);
    expect(confirmsAccountEmail("", "student@example.com")).toBe(false);
    expect(confirmsAccountEmail(null, "student@example.com")).toBe(false);
    expect(confirmsAccountEmail("student@example.com", undefined)).toBe(false);
  });
});
