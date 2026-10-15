import { describe, expect, it } from "vitest";
import { computeInsights, type InsightSession, type InsightTask } from "@/lib/preferences/insights";

const now = new Date("2026-08-15T12:00:00Z");
const timeZone = "UTC";

const completed = (estimated: number, actual: number, completedAt = "2026-08-10T10:00:00Z"): InsightTask => ({
  status: "completed", estimated_minutes: estimated, actual_minutes: actual, completed_at: completedAt, updated_at: completedAt,
});
const deferred = (updatedAt: string, estimated = 90, status = "deferred"): InsightTask => ({
  status, estimated_minutes: estimated, actual_minutes: null, completed_at: null, updated_at: updatedAt,
});
const session = (startedAt: string, minutes: number): InsightSession => ({ started_at: startedAt, minutes });

describe("computeInsights", () => {
  it("returns nothing for an empty history", () => {
    expect(computeInsights({ tasks: [], sessions: [], timeZone, now })).toEqual([]);
  });

  it("reports estimate accuracy only with at least five recent completed tasks", () => {
    const four = Array.from({ length: 4 }, () => completed(60, 90));
    expect(computeInsights({ tasks: four, sessions: [], timeZone, now })).toEqual([]);

    const [insight] = computeInsights({ tasks: [...four, completed(60, 90)], sessions: [], timeZone, now });
    expect(insight).toEqual({ id: "estimate_accuracy", text: "Completed tasks took about 1.5x their estimates (5 completed tasks, last 30 days)." });

    const accurate = computeInsights({ tasks: Array.from({ length: 5 }, () => completed(60, 63)), sessions: [], timeZone, now });
    expect(accurate[0].text).toContain("within 15%");
  });

  it("ignores completed tasks older than 30 days", () => {
    const old = Array.from({ length: 5 }, () => completed(60, 90, "2026-07-01T10:00:00Z"));
    expect(computeInsights({ tasks: old, sessions: [], timeZone, now })).toEqual([]);
  });

  it("flags repeated late-evening deferrals of long tasks", () => {
    const tasks = [deferred("2026-08-12T21:30:00Z"), deferred("2026-08-13T22:15:00Z", 60, "skipped")];
    const [insight] = computeInsights({ tasks, sessions: [], timeZone, now });
    expect(insight.id).toBe("late_deferrals");
    expect(insight.text).toContain("2 long tasks");
  });

  it("does not flag short tasks, daytime deferrals, or a single occurrence", () => {
    const tasks = [deferred("2026-08-12T21:30:00Z"), deferred("2026-08-12T14:00:00Z"), deferred("2026-08-13T22:00:00Z", 30)];
    expect(computeInsights({ tasks, sessions: [], timeZone, now })).toEqual([]);
  });

  it("uses the user's timezone for the evening cutoff", () => {
    // 16:00 UTC is 21:30 in Asia/Kolkata.
    const tasks = [deferred("2026-08-12T16:00:00Z"), deferred("2026-08-13T16:30:00Z")];
    expect(computeInsights({ tasks, sessions: [], timeZone: "UTC", now })).toEqual([]);
    expect(computeInsights({ tasks, sessions: [], timeZone: "Asia/Kolkata", now })[0].id).toBe("late_deferrals");
  });

  it("names the dominant focus window once enough time is tracked", () => {
    const sessions = [session("2026-08-10T09:10:00Z", 60), session("2026-08-11T10:00:00Z", 60), session("2026-08-12T11:30:00Z", 60), session("2026-08-12T15:00:00Z", 30)];
    const [insight] = computeInsights({ tasks: [], sessions, timeZone, now });
    expect(insight).toEqual({ id: "focus_hours", text: "86% of your tracked focus time in the last two weeks started between 9 AM and noon." });
  });

  it("stays quiet when little time is tracked or focus is spread out", () => {
    expect(computeInsights({ tasks: [], sessions: [session("2026-08-10T09:00:00Z", 90)], timeZone, now })).toEqual([]);
    const spread = [0, 3, 6, 9, 12].map((hour, index) => session(`2026-08-1${index}T${String(hour + 6).padStart(2, "0")}:00:00Z`, 40));
    expect(computeInsights({ tasks: [], sessions: spread, timeZone, now })).toEqual([]);
  });
});
