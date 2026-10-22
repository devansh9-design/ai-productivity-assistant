import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { selectLogTasks, type LogOutcome, type RoutineMetricSource } from "@/lib/evening/log";
import { getCompletedToday } from "@/lib/tasks/filters";
import type { Checkin, DailyPlan, Goal, GoalMetric, JournalEntry, PlanBlock, Routine, Task } from "@/lib/types";

export interface EveningLogTask {
  id: string;
  title: string;
  status: Task["status"];
  isRoutine: boolean;
  /** "13:00-14:00" when it is on today's plan. */
  plannedTime: string | null;
  outcome: LogOutcome | null;
  reason: string | null;
}

export interface EveningLogMetric {
  id: string;
  name: string;
  unit: string | null;
  goalTitle: string;
  /** Today's saved reading, if any. */
  value: number | null;
}

export interface EveningLogData {
  date: string;
  tasks: EveningLogTask[];
  metrics: EveningLogMetric[];
  routineSources: RoutineMetricSource[];
  evening: { mood: number | null; lesson: string | null; note: string | null };
  /** True once anything has been saved for the day. */
  saved: boolean;
}

/** Everything the evening log for one day shows, through the student's own RLS-scoped client. */
export async function loadEveningLog(supabase: SupabaseClient, date: string, timeZone: string): Promise<EveningLogData> {
  const [tasksResult, plansResult, itemsResult, goalsResult, checkinResult, journalResult] = await Promise.all([
    supabase.from("tasks").select("*").returns<Task[]>(),
    supabase.from("daily_plans").select("id,status,version").eq("plan_date", date)
      .in("status", ["draft", "publishing", "publication_failed", "confirmed"])
      .order("version", { ascending: false }).limit(1).returns<Array<Pick<DailyPlan, "id" | "status" | "version">>>(),
    supabase.from("evening_log_items").select("task_id,outcome,reason").eq("log_date", date)
      .returns<Array<{ task_id: string; outcome: LogOutcome; reason: string | null }>>(),
    supabase.from("goals").select("id,title").eq("status", "active").returns<Array<Pick<Goal, "id" | "title">>>(),
    supabase.from("checkins").select("*").eq("checkin_date", date).eq("type", "evening").maybeSingle<Checkin>(),
    supabase.from("journal_entries").select("*").eq("entry_date", date).maybeSingle<JournalEntry>(),
  ]);
  const firstError = tasksResult.error ?? plansResult.error ?? itemsResult.error ?? goalsResult.error ?? checkinResult.error ?? journalResult.error;
  if (firstError) throw new Error(firstError.message);

  const plan = plansResult.data?.[0];
  const blocksResult = plan
    ? await supabase.from("plan_blocks").select("task_id,start_time,end_time").eq("daily_plan_id", plan.id).eq("kind", "task")
      .returns<Array<Pick<PlanBlock, "task_id" | "start_time" | "end_time">>>()
    : { data: [], error: null };
  if (blocksResult.error) throw new Error(blocksResult.error.message);
  const plannedStart = new Map<string, string>();
  const plannedTime = new Map<string, string>();
  for (const block of blocksResult.data ?? []) {
    if (!block.task_id || plannedStart.has(block.task_id)) continue;
    plannedStart.set(block.task_id, block.start_time);
    plannedTime.set(block.task_id, `${block.start_time.slice(0, 5)}-${block.end_time.slice(0, 5)}`);
  }

  const allTasks = tasksResult.data ?? [];
  const items = new Map((itemsResult.data ?? []).map((item) => [item.task_id, item]));
  const tasks = selectLogTasks(allTasks, {
    date,
    completedTodayIds: new Set(getCompletedToday(allTasks, date, timeZone).map((task) => task.id)),
    plannedStart,
    loggedIds: new Set(items.keys()),
  });

  const goals = goalsResult.data ?? [];
  const goalTitle = new Map(goals.map((goal) => [goal.id, goal.title]));
  const routineIds = [...new Set(tasks.map((task) => task.routine_id).filter((id): id is string => id !== null))];
  const [metricsResult, routinesResult] = await Promise.all([
    goals.length > 0
      ? supabase.from("goal_metrics").select("*").in("goal_id", goals.map((goal) => goal.id)).order("position").returns<GoalMetric[]>()
      : Promise.resolve({ data: [] as GoalMetric[], error: null }),
    routineIds.length > 0
      ? supabase.from("routines").select("id,goal_metric_id,metric_amount").in("id", routineIds)
        .returns<Array<Pick<Routine, "id" | "goal_metric_id" | "metric_amount">>>()
      : Promise.resolve({ data: [] as Array<Pick<Routine, "id" | "goal_metric_id" | "metric_amount">>, error: null }),
  ]);
  if (metricsResult.error ?? routinesResult.error) throw new Error((metricsResult.error ?? routinesResult.error)!.message);

  const metrics = metricsResult.data ?? [];
  const logsResult = metrics.length > 0
    ? await supabase.from("progress_logs").select("goal_metric_id,value").eq("log_date", date).in("goal_metric_id", metrics.map((metric) => metric.id))
      .returns<Array<{ goal_metric_id: string; value: number }>>()
    : { data: [], error: null };
  if (logsResult.error) throw new Error(logsResult.error.message);
  const todayValue = new Map((logsResult.data ?? []).map((log) => [log.goal_metric_id, Number(log.value)]));

  const routineMetric = new Map((routinesResult.data ?? []).map((routine) => [routine.id, routine]));
  const routineSources: RoutineMetricSource[] = [];
  for (const task of tasks) {
    const routine = task.routine_id ? routineMetric.get(task.routine_id) : undefined;
    if (routine?.goal_metric_id && routine.metric_amount) {
      routineSources.push({ taskId: task.id, title: task.title, goalMetricId: routine.goal_metric_id, amount: Number(routine.metric_amount) });
    }
  }

  return {
    date,
    tasks: tasks.map((task) => {
      const item = items.get(task.id);
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        isRoutine: task.routine_id !== null,
        plannedTime: plannedTime.get(task.id) ?? null,
        // Already completed today counts as done until the student says otherwise.
        outcome: item?.outcome ?? (task.status === "completed" ? "done" : null),
        reason: item?.reason ?? null,
      };
    }),
    metrics: metrics.map((metric) => ({
      id: metric.id,
      name: metric.name,
      unit: metric.unit,
      goalTitle: goalTitle.get(metric.goal_id) ?? "Goal",
      value: todayValue.get(metric.id) ?? null,
    })),
    routineSources,
    evening: {
      mood: checkinResult.data?.mood ?? null,
      lesson: checkinResult.data?.lesson ?? null,
      note: journalResult.data?.reflection ?? null,
    },
    saved: items.size > 0 || checkinResult.data !== null || journalResult.data !== null || todayValue.size > 0,
  };
}
