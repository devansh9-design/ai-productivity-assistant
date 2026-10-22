import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMonthGrid, gridRange, type MonthCell, type MonthEvent } from "@/lib/month/view";
import { loadDayRecords } from "@/lib/week/load";
import { buildWeekDays, type WeekDay } from "@/lib/week/view";
import { addDaysToISODate } from "@/lib/tasks/timezone";

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

/**
 * One month as whole weeks: each day's completion from the same records as
 * the week view, plus commitments, task deadlines, goal target dates and
 * roadmap phase boundaries. Every query runs at once to keep it fast.
 */
export async function loadMonth(supabase: SupabaseClient, month: string, today: string, timeZone: string): Promise<MonthCell[][]> {
  const { start, end } = gridRange(month);
  const [records, commitments, deadlines, goals, phases] = await Promise.all([
    loadDayRecords(supabase, start, end, timeZone),
    supabase.from("fixed_commitments").select("commitment_date,title,start_time").gte("commitment_date", start).lte("commitment_date", end)
      .order("start_time").returns<Array<{ commitment_date: string; title: string; start_time: string }>>(),
    // Routine sessions are daily habits, not deadlines.
    supabase.from("tasks").select("title,due_date,goal_id").is("routine_id", null).not("status", "in", "(skipped)").gte("due_date", start).lte("due_date", end)
      .returns<Array<{ title: string; due_date: string; goal_id: string | null }>>(),
    supabase.from("goals").select("id,title,target_date").eq("status", "active").returns<Array<{ id: string; title: string; target_date: string | null }>>(),
    supabase.from("goal_phases").select("goal_id,title,start_date,end_date")
      .or(`and(start_date.gte.${start},start_date.lte.${end}),and(end_date.gte.${start},end_date.lte.${end})`)
      .returns<Array<{ goal_id: string; title: string; start_date: string; end_date: string }>>(),
  ]);

  const goalRows = check(goals) ?? [];
  const activeGoals = new Map(goalRows.map((goal) => [goal.id, goal.title]));
  const inRange = (date: string) => date >= start && date <= end;
  const events: MonthEvent[] = [
    ...(check(commitments) ?? []).map((row) => ({ date: row.commitment_date, kind: "commitment" as const, label: `${row.start_time.slice(0, 5)} ${row.title}`, goalId: null })),
    ...(check(deadlines) ?? []).map((row) => ({ date: row.due_date, kind: "deadline" as const, label: row.title, goalId: row.goal_id })),
    ...goalRows.filter((goal) => goal.target_date && inRange(goal.target_date))
      .map((goal) => ({ date: goal.target_date!, kind: "goal_target" as const, label: `${goal.title}: target date`, goalId: goal.id })),
    ...(check(phases) ?? []).filter((phase) => activeGoals.has(phase.goal_id)).flatMap((phase) => [
      ...(inRange(phase.start_date) ? [{ date: phase.start_date, kind: "phase_start" as const, label: `${phase.title} starts (${activeGoals.get(phase.goal_id)})`, goalId: phase.goal_id }] : []),
      ...(inRange(phase.end_date) ? [{ date: phase.end_date, kind: "phase_end" as const, label: `${phase.title} ends (${activeGoals.get(phase.goal_id)})`, goalId: phase.goal_id }] : []),
    ]),
  ];

  const days: WeekDay[] = [];
  for (let weekStart = start; weekStart <= end; weekStart = addDaysToISODate(weekStart, 7)) {
    days.push(...buildWeekDays({ weekStart, today, ...records }));
  }
  return buildMonthGrid(month, today, days, events);
}
