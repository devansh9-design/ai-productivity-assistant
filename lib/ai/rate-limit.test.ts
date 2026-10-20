import { describe, it, expect, vi } from "vitest";
import { AI_REQUESTS_PER_DAY, AI_REQUESTS_PER_MINUTE, claimAIRequest, describeWait } from "@/lib/ai/rate-limit";

function client(result: { data: unknown; error: { message: string } | null }) {
  return { rpc: vi.fn().mockResolvedValue(result) };
}

describe("claimAIRequest", () => {
  it("claims with the configured limits", async () => {
    const supabase = client({ data: 0, error: null });
    expect(await claimAIRequest(supabase as never)).toEqual({ allowed: true });
    expect(supabase.rpc).toHaveBeenCalledWith("claim_ai_request", { p_per_minute: AI_REQUESTS_PER_MINUTE, p_per_day: AI_REQUESTS_PER_DAY });
  });

  it("returns the wait when the limit is reached", async () => {
    expect(await claimAIRequest(client({ data: 42, error: null }) as never)).toEqual({ allowed: false, retryAfterSeconds: 42 });
  });

  it("throws instead of allowing an unmetered call when the check fails", async () => {
    await expect(claimAIRequest(client({ data: null, error: { message: "function does not exist" } }) as never)).rejects.toThrow("could not be checked");
    await expect(claimAIRequest(client({ data: "0", error: null }) as never)).rejects.toThrow("could not be checked");
  });
});

describe("describeWait", () => {
  it("uses seconds, minutes or hours", () => {
    expect(describeWait(40)).toBe("about 40 seconds");
    expect(describeWait(600)).toBe("about 10 minutes");
    expect(describeWait(7200)).toBe("about 2 hours");
  });
});
