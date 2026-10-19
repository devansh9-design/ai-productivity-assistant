import { describe, it, expect, vi, afterEach } from "vitest";
import { errorFields, log } from "@/lib/log";

vi.mock("server-only", () => ({}));

afterEach(() => vi.restoreAllMocks());

function captured(spy: ReturnType<typeof vi.spyOn>) {
  return JSON.parse(String(spy.mock.calls[0][0]));
}

describe("log", () => {
  it("writes one JSON line with level, event and time to the matching console method", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    log("error", "plan.publish_failed", { planId: "p1" });
    expect(info).not.toHaveBeenCalled();
    expect(captured(error)).toMatchObject({ level: "error", event: "plan.publish_failed", planId: "p1", time: expect.any(String) });
  });

  it("redacts secret-looking fields at any depth", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    log("warn", "test", { accessToken: "abc", nested: { apiKey: "k", Authorization: "Bearer x", safe: "ok" } });
    const line = String(warn.mock.calls[0][0]);
    expect(line).not.toContain("abc");
    expect(line).not.toContain("Bearer x");
    expect(captured(warn)).toMatchObject({ accessToken: "[redacted]", nested: { apiKey: "[redacted]", Authorization: "[redacted]", safe: "ok" } });
  });

  it("shortens long strings", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    log("info", "test", { text: "x".repeat(2000) });
    expect(captured(info).text.length).toBeLessThan(510);
  });
});

describe("errorFields", () => {
  it("keeps name, message, code, status and digest only", () => {
    const error = Object.assign(new Error("boom"), { code: "PGRST303", status: 401, digest: "d1", stackExtra: "x" });
    expect(errorFields(error)).toEqual({ error: "Error", message: "boom", code: "PGRST303", status: 401, digest: "d1" });
  });

  it("does not echo arbitrary thrown objects", () => {
    expect(errorFields({ token: "secret" })).toEqual({ error: "Non-error value thrown" });
  });
});
