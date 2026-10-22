import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import * as authModule from "@/lib/auth/require-user";
import * as geminiModule from "@/lib/gemini";
import * as loadModule from "@/lib/review/load";
import { buildWeekFacts, weekRange } from "@/lib/review/facts";
import { generateWeeklySummary, saveWeeklyPlan } from "@/lib/review/actions";
import type { AnalyticsTask } from "@/lib/analytics/metrics";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const task = (id: string, overrides: Partial<AnalyticsTask> = {}): AnalyticsTask => ({
  id, title: `Task ${id}`, category: null, status: "todo", status_reason: null, due_date: null,
  completed_at: null, updated_at: "2026-09-01T00:00:00Z", actual_minutes: null,
  goal_id: null, ...overrides,
});

function facts(empty: boolean) {
  return buildWeekFacts({
    range: weekRange("2026-10-05"), today: "2026-10-15", timeZone: "UTC",
    tasks: empty ? [] : [task("done1", { title: "Arrays drill", status: "completed", completed_at: "2026-10-06T10:00:00Z", actual_minutes: 30 })],
    sessions: [], plans: [], planBlocks: [], goals: [],
  }, []);
}

let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;

/** aiWait is what claim_ai_request answers: 0 allows the AI call, more is the wait in seconds. */
function signIn(aiWait = 0) {
  rpcCalls = [];
  const supabase = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "claim_ai_request") return Promise.resolve({ data: aiWait, error: null });
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  };
  vi.spyOn(authModule, "requireUser").mockResolvedValue({ supabase, user: { id: "user-1" } } as never);
}

function form(fields: Record<string, string>, shortlist: string[] = []) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  for (const id of shortlist) data.append("shortlist", id);
  return data;
}

beforeEach(() => {
  // Thursday 15 October 2026: review 5-11 October, plan 19-25 October.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: "UTC" }) } as never);
  signIn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("generateWeeklySummary", () => {
  it("never calls the AI for an empty week", async () => {
    vi.spyOn(loadModule, "loadWeekFacts").mockResolvedValue(facts(true));
    const gemini = vi.spyOn(geminiModule, "generateGeminiJson");
    await generateWeeklySummary(form({ week: "2026-10-05" }));
    expect(gemini).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toMatchObject({ p_review_week_start: "2026-10-05", p_source: "fallback", p_headline: "Nothing was recorded for this week." });
  });

  it("keeps an AI summary whose references check out", async () => {
    vi.spyOn(loadModule, "loadWeekFacts").mockResolvedValue(facts(false));
    vi.spyOn(geminiModule, "generateGeminiJson").mockResolvedValue({
      headline: "A calm, steady week.", suggestion: "Keep mornings for deep work.",
      highlights: [{ task_id: "done1", note: "A solid foundation." }], observations: [],
    });
    const result = await generateWeeklySummary(form({ week: "2026-10-05" }));
    expect(result).toEqual({ message: "Summary generated and checked against your data." });
    expect(rpcCalls[0].args).toMatchObject({ p_source: "ai", p_highlights: [{ task_id: "done1", note: "A solid foundation." }], p_fallback_reason: null });
  });

  it("saves the code-written summary when the AI invents a task", async () => {
    vi.spyOn(loadModule, "loadWeekFacts").mockResolvedValue(facts(false));
    vi.spyOn(geminiModule, "generateGeminiJson").mockResolvedValue({
      headline: "Great week.", suggestion: "", highlights: [{ task_id: "invented", note: "Nice" }], observations: [],
    });
    await generateWeeklySummary(form({ week: "2026-10-05" }));
    expect(rpcCalls[0].args).toMatchObject({ p_source: "fallback", p_headline: "You completed 1 task and logged 30m." });
    expect(String(rpcCalls[0].args.p_fallback_reason)).toContain("not completed this week");
  });

  it("saves the code-written summary when the AI is unavailable", async () => {
    vi.spyOn(loadModule, "loadWeekFacts").mockResolvedValue(facts(false));
    vi.spyOn(geminiModule, "generateGeminiJson").mockRejectedValue(new Error("quota"));
    const result = await generateWeeklySummary(form({ week: "2026-10-05" }));
    expect(rpcCalls[0].args).toMatchObject({ p_source: "fallback" });
    expect(result).toEqual({ message: expect.stringContaining("The AI service was unavailable") });
  });

  it("writes the summary from the numbers without calling the AI when the request limit is reached", async () => {
    signIn(1800);
    vi.spyOn(loadModule, "loadWeekFacts").mockResolvedValue(facts(false));
    const gemini = vi.spyOn(geminiModule, "generateGeminiJson");
    const result = await generateWeeklySummary(form({ week: "2026-10-05" }));
    expect(gemini).not.toHaveBeenCalled();
    expect(rpcCalls[0].args).toMatchObject({ p_source: "fallback" });
    expect(result).toEqual({ message: expect.stringContaining("AI request limit was reached") });
  });

  it("only reviews a listed week, whatever the form says", async () => {
    const load = vi.spyOn(loadModule, "loadWeekFacts").mockResolvedValue(facts(true));
    await generateWeeklySummary(form({ week: "2030-01-07" }));
    expect(load.mock.calls[0][2]).toBe("2026-10-05");
  });
});

describe("saveWeeklyPlan", () => {
  beforeEach(() => {
    vi.spyOn(loadModule, "loadOpenTasks").mockResolvedValue([
      { id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" },
    ] as never);
  });

  it("saves to the planning week derived on the server, in one call, and touches nothing else", async () => {
    const result = await saveWeeklyPlan(form({ planning_week: "2026-10-19", review_week: "2026-09-28", priority_1_task: "a", priority_2_new: "Draft the essay" }, ["b"]));
    expect(result).toEqual({ message: expect.stringContaining("Mon 19 Oct") });
    expect(rpcCalls).toEqual([{
      name: "save_weekly_plan",
      args: {
        p_planning_week_start: "2026-10-19",
        p_review_week_start: "2026-09-28",
        p_priorities: [{ task_id: "a" }, { new_title: "Draft the essay" }],
        p_shortlist: [{ task_id: "b" }],
      },
    }]);
  });

  it("refuses to save if the planning week changed since the page loaded", async () => {
    const result = await saveWeeklyPlan(form({ planning_week: "2026-10-12", priority_1_task: "a" }));
    expect(result).toEqual({ error: expect.stringContaining("planning week has changed") });
    expect(rpcCalls).toEqual([]);
  });

  it("returns validation errors without saving anything", async () => {
    const result = await saveWeeklyPlan(form({ planning_week: "2026-10-19", priority_1_task: "a", priority_1_new: "Also this" }));
    expect(result).toEqual({ error: "Priority 1: choose a task or type a new title, not both." });
    expect(rpcCalls).toEqual([]);
  });
});
