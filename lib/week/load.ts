import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LogOutcome } from "@/lib/evening/log";
import type { DayFacts } from "@/lib/feedback/daily";
import { loadDayFacts } from "@/lib/feedback/load";
import { weekEnd } from "@/lib/review/week";
import { getTodayISODate } from "@/lib/tasks/timezone";
import { buildRoutineGrid, buildWeekDays, type RoutineRow, type WeekDay } from "@/lib/week/view";
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

/** One week (Monday to Sunday, up to today) through the student's own RLS-scoped client. */
export async function loadWeekView(supabase: SupabaseClient, weekStart: string, today: string, timeZone: string): Promise<WeekView> {
  const end = weekEnd(weekStart);
  const lastDay = end < today ? end : today;
  const [plans, items, checkins, routines, goals, routineTasks, facts] = await Promise.all([
    supabase.from("daily_plans").select("id,plan_date,status,version").gte("plan_date", weekStart).lte("plan_date", end)
      .returns<Array<{ id: string; plan_date: string; status: string; version: number }>>(),
    supabase.from("evening_log_items").select("task_id,log_date,outcome").gte("log_date", weekStart).lte("log_date", end)
      .returns<Array<{ task_id: string; log_date: string; outcome: LogOutcome }>>(),
    supabase.from("checkins").select("checkin_date").eq("type", "evening").gte("checkin_date", weekStart).lte("checkin_date", end)
      .returns<Array<{ checkin_date: string }>>(),
    supabase.from("routines").select("*").order("created_at").returns<Routine[]>(),
    supabase.from("goals").select("id,title,status").returns<Array<{ id: string; title: string; status: string }>>(),
    supabase.from("tasks").select("routine_id,occurrence_date,status").not("routine_id", "is", null)
      .gte("occurrence_date", weekStart).lte("occurrence_date", end)
      .returns<Array<{ routine_id: string; occurrence_date: string; status: string }>>(),
    loadDayFacts(supabase, lastDay),
  ]);
  const planRows = check(plans) ?? [];
  const blocks = planRows.length > 0
    ? check(await supabase.from("plan_blocks").select("daily_plan_id,task_id").in("daily_plan_id", planRows.map((plan) => plan.id)).eq("kind", "task")
      .returns<Array<{ daily_plan_id: string; task_id: string | null }>>()) ?? []
    : [];
  const taskIds = [...new Set(blocks.map((block) => block.task_id).filter((id): id is string => id !== null))];
  const tasks = taskIds.length > 0
    ? check(await supabase.from("tasks").select("id,completed_at").in("id", taskIds).returns<Array<{ id: string; completed_at: string | null }>>()) ?? []
    : [];

  const itemRows = check(items) ?? [];
  const goalRows = check(goals) ?? [];
  const goalTitle = new Map(goalRows.map((goal) => [goal.id, goal.title]));
  const archivedGoals = new Set(goalRows.filter((goal) => goal.status !== "active").map((goal) => goal.id));

  return {
    weekStart,
    finished: end < today,
    days: buildWeekDays({
      weekStart,
      today,
      plans: planRows.map((plan) => ({
        date: plan.plan_date,
        status: plan.status,
        version: plan.version,
        taskIds: blocks.filter((block) => block.daily_plan_id === plan.id && block.task_id).map((block) => block.task_id!),
      })),
      logItems: itemRows.map((item) => ({ date: item.log_date, taskId: item.task_id, outcome: item.outcome })),
      tasks: tasks.map((task) => ({ id: task.id, completedOn: task.completed_at ? getTodayISODate(timeZone, new Date(task.completed_at)) : null })),
      loggedDates: [...itemRows.map((item) => item.log_date), ...(check(checkins) ?? []).map((row) => row.checkin_date)],
    }),
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
