import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LogOutcome } from "@/lib/evening/log";
import type { DayFacts } from "@/lib/feedback/daily";
import { loadDayFacts } from "@/lib/feedback/load";
import { weekEnd } from "@/lib/review/week";
import { getTodayISODate } from "@/lib/tasks/timezone";
import { buildRoutineGrid, buildWeekDays, type RoutineRow, type WeekDay, type WeekDaysInput } from "@/lib/week/view";
import type { Routine } from "@/lib/types";

export interface WeekView {
  weekStart: string;
  /** The week has ended, so targets are met or missed rather than on track or behind. */
  finished: boolean;
  days: WeekDay[];
  goals: DayFacts["goals"];
  routines: RoutineRow[];
}

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

/** What buildWeekDays needs for any range of days: plans, log outcomes, completions and saved logs. */
export type DayRecords = Omit<WeekDaysInput, "weekStart" | "today">;

/** Plans, evening log outcomes and completions for the days from start to end (inclusive). */
export async function loadDayRecords(supabase: SupabaseClient, start: string, end: string, timeZone: string): Promise<DayRecords> {
  // Plans come with their task blocks and those tasks' completion in one query, so the whole range is one round of requests.
  const [plans, items, checkins] = await Promise.all([
    supabase.from("daily_plans").select("plan_date,status,version,plan_blocks(task_id,kind,tasks(completed_at))").gte("plan_date", start).lte("plan_date", end)
      .returns<Array<{ plan_date: string; status: string; version: number; plan_blocks: Array<{ task_id: string | null; kind: string; tasks: { completed_at: string | null } | null }> }>>(),
    supabase.from("evening_log_items").select("task_id,log_date,outcome").gte("log_date", start).lte("log_date", end)
      .returns<Array<{ task_id: string; log_date: string; outcome: LogOutcome }>>(),
    supabase.from("checkins").select("checkin_date").eq("type", "evening").gte("checkin_date", start).lte("checkin_date", end)
      .returns<Array<{ checkin_date: string }>>(),
  ]);
  const planRows = check(plans) ?? [];
  const completedAt = new Map<string, string | null>();
  for (const plan of planRows) {
    for (const block of plan.plan_blocks) if (block.task_id && block.kind === "task") completedAt.set(block.task_id, block.tasks?.completed_at ?? null);
  }
  const itemRows = check(items) ?? [];
  return {
    plans: planRows.map((plan) => ({
      date: plan.plan_date,
      status: plan.status,
      version: plan.version,
      taskIds: plan.plan_blocks.filter((block) => block.task_id && block.kind === "task").map((block) => block.task_id!),
    })),
    logItems: itemRows.map((item) => ({ date: item.log_date, taskId: item.task_id, outcome: item.outcome })),
    tasks: [...completedAt].map(([id, completed]) => ({ id, completedOn: completed ? getTodayISODate(timeZone, new Date(completed)) : null })),
    loggedDates: [...itemRows.map((item) => item.log_date), ...(check(checkins) ?? []).map((row) => row.checkin_date)],
  };
}

/** One week (Monday to Sunday, up to today) through the student's own RLS-scoped client. */
export async function loadWeekView(supabase: SupabaseClient, weekStart: string, today: string, timeZone: string): Promise<WeekView> {
  const end = weekEnd(weekStart);
  const lastDay = end < today ? end : today;
  const [records, routines, goals, routineTasks, facts] = await Promise.all([
    loadDayRecords(supabase, weekStart, end, timeZone),
    supabase.from("routines").select("*").order("created_at").returns<Routine[]>(),
    supabase.from("goals").select("id,title,status").returns<Array<{ id: string; title: string; status: string }>>(),
    supabase.from("tasks").select("routine_id,occurrence_date,status").not("routine_id", "is", null)
      .gte("occurrence_date", weekStart).lte("occurrence_date", end)
      .returns<Array<{ routine_id: string; occurrence_date: string; status: string }>>(),
    loadDayFacts(supabase, lastDay),
  ]);
  const goalRows = check(goals) ?? [];
  const goalTitle = new Map(goalRows.map((goal) => [goal.id, goal.title]));
  const archivedGoals = new Set(goalRows.filter((goal) => goal.status !== "active").map((goal) => goal.id));

  return {
    weekStart,
    finished: end < today,
    days: buildWeekDays({ weekStart, today, ...records }),
    goals: facts.goals,
    routines: buildRoutineGrid({
      weekStart,
      today,
      routines: (check(routines) ?? []).filter((routine) => !routine.goal_id || !archivedGoals.has(routine.goal_id)).map((routine) => ({
        id: routine.id,
        title: routine.title,
        goalTitle: routine.goal_id ? goalTitle.get(routine.goal_id) ?? null : null,
        daysOfWeek: routine.days_of_week,
        startDate: routine.start_date,
        endDate: routine.end_date,
        active: routine.active,
      })),
      routineTasks: (check(routineTasks) ?? []).map((task) => ({ routineId: task.routine_id, occurrenceDate: task.occurrence_date, status: task.status })),
    }),
  };
}
