import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Gemini calls each user may make; claimed before the call, so failed calls count too. */
export const AI_REQUESTS_PER_MINUTE = 6;
export const AI_REQUESTS_PER_DAY = 40;

/**
 * Gemini calls all users together may make per Gemini quota day (midnight to
 * midnight Pacific), so the shared free quota can't run out. Set
 * AI_GLOBAL_REQUESTS_PER_DAY to match the project's quota in Google AI Studio.
 */
export function globalRequestsPerDay(): number {
  const configured = Number(process.env.AI_GLOBAL_REQUESTS_PER_DAY);
  return Number.isInteger(configured) && configured > 0 ? configured : 500;
}

export type AILimitScope = "minute" | "day" | "global";
export type AIRequestClaim = { allowed: true } | { allowed: false; retryAfterSeconds: number; scope: AILimitScope };

const SCOPES = new Set<string>(["minute", "day", "global"]);

/**
 * Claims one AI request for the signed-in user (see claim_ai_request). Throws
 * when the limit cannot be checked: the caller must not call Gemini unmetered.
 */
export async function claimAIRequest(supabase: SupabaseClient): Promise<AIRequestClaim> {
  const { data, error } = await supabase.rpc("claim_ai_request", {
    p_per_minute: AI_REQUESTS_PER_MINUTE,
    p_per_day: AI_REQUESTS_PER_DAY,
    p_global_per_day: globalRequestsPerDay(),
  });
  const retryAfter = (data as { retry_after?: unknown } | null)?.retry_after;
  const scope = (data as { scope?: unknown } | null)?.scope;
  if (error || typeof retryAfter !== "number") throw new Error(`AI rate limit could not be checked: ${error?.message ?? "unexpected response"}`);
  if (retryAfter === 0) return { allowed: true };
  return { allowed: false, retryAfterSeconds: retryAfter, scope: typeof scope === "string" && SCOPES.has(scope) ? scope as AILimitScope : "day" };
}

/** What to tell the user when a claim is refused. */
export function limitMessage(claim: { retryAfterSeconds: number; scope: AILimitScope }): string {
  const wait = describeWait(claim.retryAfterSeconds);
  return claim.scope === "global"
    ? `The AI is resting: all students together have used today's share. It's back in ${wait}, and everything else keeps working.`
    : `You've reached the AI limit of ${AI_REQUESTS_PER_MINUTE} requests a minute and ${AI_REQUESTS_PER_DAY} a day. Try again in ${wait}.`;
}

/** A short, human wait such as "about 40 seconds" or "about 3 hours". */
export function describeWait(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} minutes`;
  return `about ${Math.round(seconds / 3600)} hours`;
}
