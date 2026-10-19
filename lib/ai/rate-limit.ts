import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Gemini calls each user may make; claimed before the call, so failed calls count too. */
export const AI_REQUESTS_PER_MINUTE = 6;
export const AI_REQUESTS_PER_DAY = 100;

export type AIRequestClaim = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Claims one AI request for the signed-in user (see claim_ai_request). Throws
 * when the limit cannot be checked: the caller must not call Gemini unmetered.
 */
export async function claimAIRequest(supabase: SupabaseClient): Promise<AIRequestClaim> {
  const { data, error } = await supabase.rpc("claim_ai_request", {
    p_per_minute: AI_REQUESTS_PER_MINUTE,
    p_per_day: AI_REQUESTS_PER_DAY,
  });
  if (error || typeof data !== "number") throw new Error(`AI rate limit could not be checked: ${error?.message ?? "unexpected response"}`);
  return data === 0 ? { allowed: true } : { allowed: false, retryAfterSeconds: data };
}

/** A short, human wait such as "about 40 seconds" or "about 3 hours". */
export function describeWait(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} minutes`;
  return `about ${Math.round(seconds / 3600)} hours`;
}
