import { afterEach, describe, it, expect, vi } from "vitest";
import { AI_REQUESTS_PER_DAY, AI_REQUESTS_PER_MINUTE, claimAIRequest, describeWait, globalRequestsPerDay, limitMessage } from "@/lib/ai/rate-limit";

function client(result: { data: unknown; error: { message: string } | null }) {
  return { rpc: vi.fn().mockResolvedValue(result) };
}

afterEach(() => vi.unstubAllEnvs());

describe("claimAIRequest", () => {
  it("claims with the configured limits", async () => {
    const supabase = client({ data: { retry_after: 0 }, error: null });
    expect(await claimAIRequest(supabase as never)).toEqual({ allowed: true });
    expect(supabase.rpc).toHaveBeenCalledWith("claim_ai_request", {
      p_per_minute: AI_REQUESTS_PER_MINUTE, p_per_day: AI_REQUESTS_PER_DAY, p_global_per_day: 500,
    });
  });

  it("returns the wait and which limit was reached", async () => {
    expect(await claimAIRequest(client({ data: { retry_after: 42, scope: "minute" }, error: null }) as never))
      .toEqual({ allowed: false, retryAfterSeconds: 42, scope: "minute" });
    expect(await claimAIRequest(client({ data: { retry_after: 3600, scope: "global" }, error: null }) as never))
      .toEqual({ allowed: false, retryAfterSeconds: 3600, scope: "global" });
  });

  it("throws instead of allowing an unmetered call when the check fails", async () => {
    await expect(claimAIRequest(client({ data: null, error: { message: "function does not exist" } }) as never)).rejects.toThrow("could not be checked");
    await expect(claimAIRequest(client({ data: 0, error: null }) as never)).rejects.toThrow("could not be checked");
    await expect(claimAIRequest(client({ data: { retry_after: "0" }, error: null }) as never)).rejects.toThrow("could not be checked");
  });
});

describe("globalRequestsPerDay", () => {
  it("reads a positive whole number from the environment, else 500", () => {
    vi.stubEnv("AI_GLOBAL_REQUESTS_PER_DAY", "1200");
    expect(globalRequestsPerDay()).toBe(1200);
    for (const bad of ["", "0", "-5", "12.5", "lots"]) {
      vi.stubEnv("AI_GLOBAL_REQUESTS_PER_DAY", bad);
      expect(globalRequestsPerDay()).toBe(500);
    }
  });
});

describe("limitMessage", () => {
  it("explains a personal limit and the shared one differently", () => {
    expect(limitMessage({ retryAfterSeconds: 40, scope: "minute" })).toContain(`${AI_REQUESTS_PER_DAY} a day`);
    expect(limitMessage({ retryAfterSeconds: 7200, scope: "global" })).toBe(
      "The AI is resting: all students together have used today's share. It's back in about 2 hours, and everything else keeps working.",
    );
  });
});

describe("describeWait", () => {
  it("uses seconds, minutes or hours", () => {
    expect(describeWait(40)).toBe("about 40 seconds");
    expect(describeWait(600)).toBe("about 10 minutes");
    expect(describeWait(7200)).toBe("about 2 hours");
  });
});
