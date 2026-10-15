import type { AnalyticsRange } from "@/lib/analytics/range";
import { addDaysToISODate, getTodayISODate } from "@/lib/tasks/timezone";

/** A timer session longer than this was almost certainly left running by mistake. */
export const MAX_SESSION_MINUTES = 12 * 60;

/**
 * A plan the user committed to. create_draft_plan only ever supersedes a
 * confirmed plan (drafts are reused in place), so a superseded plan was
 * confirmed at some point too.
 */
export const COMMITTED_PLAN_STATUSES = ["confirmed", "completed", "superseded"] as const;

const OPEN_TASK_STATUSES = new Set(["todo", "in_progress", "deferred"]);
const TOP_REASONS = 5;

export interface AnalyticsTask {
  id: string;
  title: string;
  category: string | null;
  status: string;
  status_reason: string | null;
  due_date: string | null;
  completed_at: string | null;
  updated_at: string;
  actual_minutes: number | null;
  goal_id: string | null;
  project_id: string | null;
  milestone_id: string | null;
}

export interface AnalyticsSession {
  id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  minutes: number | null;
}

export interface AnalyticsPlan {
  id: string;
  plan_date: string;
  status: string;
  version: number;
}

export interface AnalyticsPlanBlock {
  daily_plan_id: string;
  task_id: string | null;
  kind: string;
  start_time: string;
  end_time: string;
}

export interface AnalyticsGoal { id: string; title: string; status: string }
export interface AnalyticsProject { id: string; goal_id: string | null }
export interface AnalyticsMilestone { id: string; title: string; status: string; due_date: string | null; project_id: string | null }

export interface AnalyticsInput {
  range: AnalyticsRange;
  /** The user's local date right now. */
  today: string;
  timeZone: string;
  tasks: AnalyticsTask[];
  sessions: AnalyticsSession[];
  plans: AnalyticsPlan[];
  planBlocks: AnalyticsPlanBlock[];
  goals: AnalyticsGoal[];
  projects: AnalyticsProject[];
  milestones: AnalyticsMilestone[];
}

export interface DailyPoint {
  date: string;
  /** Null when the day has no committed plan. */
  plannedMinutes: number | null;
  loggedMinutes: number;
}

export interface Bar { label: string; value: number }

export interface ProgressItem {
  id: string;
  title: string;
  completed: number;
  total: number;
  /** Null when nothing countable is linked. */
  percent: number | null;
  dueDate?: string | null;
}

export interface AnalyticsResult {
  loggedMinutes: number;
  timerMinutes: number;
  manualMinutes: number;
  daily: DailyPoint[];
  completion: { planned: number; completedOnTime: number; rate: number | null; daysCounted: number };
  /** The planned task occurrences counted above that were not done on or before their day. */
  missedPlanned: Array<{ taskId: string; date: string }>;
  categories: Bar[];
  overdueCount: number;
  streak: { current: number; longestInRange: number };
  reasons: Bar[];
  reasonTaskCount: number;
  goals: ProgressItem[];
  milestones: ProgressItem[];
  excluded: { open: number; empty: number; overlong: number };
}

interface TimeEntry { taskId: string; date: string; minutes: number; source: "timer" | "manual" }

type SessionValidity = "valid" | "open" | "empty" | "overlong";

export function sessionValidity(session: AnalyticsSession): SessionValidity {
  if (session.ended_at === null) return "open";
  if (!session.minutes || session.minutes <= 0) return "empty";
  if (session.minutes > MAX_SESSION_MINUTES) return "overlong";
  return "valid";
}

function minutesOf(time: string): number {
  const match = /^(\d{2}):(\d{2})/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

/** Case- and whitespace-insensitive grouping key. */
function groupKey(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Groups values that differ only in case or spacing. The display label is the
 * alphabetically first spelling seen, so the result does not depend on row order.
 */
function groupTotals(items: Array<{ raw: string | null; amount: number }>, emptyLabel: string): Bar[] {
  const groups = new Map<string, { label: string; value: number }>();
  for (const { raw, amount } of items) {
    const key = groupKey(raw);
    const spelled = key ? (raw as string).trim().replace(/\s+/g, " ") : emptyLabel;
    const group = groups.get(key);
    if (!group) groups.set(key, { label: spelled, value: amount });
    else {
      group.value += amount;
      if (spelled < group.label) group.label = spelled;
    }
  }
  return [...groups.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function progress(id: string, title: string, linked: AnalyticsTask[]): ProgressItem {
  const countable = linked.filter((task) => task.status !== "skipped");
  const completed = countable.filter((task) => task.status === "completed").length;
  return { id, title, completed, total: countable.length, percent: countable.length ? Math.round((completed / countable.length) * 100) : null };
}

/**
 * Pure analytics over one user's rows. All day boundaries are the user's
 * local days. Every time figure is built from one list of time entries, in
 * which a task contributes either its valid timer sessions or, if it has
 * none, its manually entered actual minutes on its completion day. That makes
 * the category and daily totals always add up to the headline total.
 */
export function computeAnalytics(input: AnalyticsInput): AnalyticsResult {
  const { range, today, timeZone } = input;
  const localDate = (iso: string) => getTodayISODate(timeZone, new Date(iso));
  const inRange = new Set(range.days);
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const sessions = [...new Map(input.sessions.map((session) => [session.id, session])).values()];

  // Logged time.
  const timedTaskIds = new Set(sessions.filter((session) => sessionValidity(session) === "valid").map((session) => session.task_id));
  const excluded = { open: 0, empty: 0, overlong: 0 };
  const entries: TimeEntry[] = [];
  for (const session of sessions) {
    const date = localDate(session.started_at);
    if (!inRange.has(date)) continue;
    const validity = sessionValidity(session);
    if (validity === "valid") entries.push({ taskId: session.task_id, date, minutes: session.minutes as number, source: "timer" });
    else excluded[validity] += 1;
  }
  for (const task of input.tasks) {
    if (task.status !== "completed" || !task.completed_at || !(task.actual_minutes && task.actual_minutes > 0) || timedTaskIds.has(task.id)) continue;
    const date = localDate(task.completed_at);
    if (inRange.has(date)) entries.push({ taskId: task.id, date, minutes: task.actual_minutes, source: "manual" });
  }
  const sum = (items: TimeEntry[]) => items.reduce((total, entry) => total + entry.minutes, 0);

  // Committed plans: the latest committed version for each day in range.
  const committed = new Map<string, AnalyticsPlan>();
  for (const plan of input.plans) {
    if (!(COMMITTED_PLAN_STATUSES as readonly string[]).includes(plan.status) || !inRange.has(plan.plan_date)) continue;
    const current = committed.get(plan.plan_date);
    if (!current || plan.version > current.version) committed.set(plan.plan_date, plan);
  }
  const taskBlocksByPlan = new Map<string, AnalyticsPlanBlock[]>();
  for (const block of input.planBlocks) {
    // Blocks are deleted with their task; skipping unknown tasks keeps planned
    // time, the completion rate, and the missed list consistent if one remains.
    if (block.kind !== "task" || !block.task_id || !taskById.has(block.task_id)) continue;
    taskBlocksByPlan.set(block.daily_plan_id, [...(taskBlocksByPlan.get(block.daily_plan_id) ?? []), block]);
  }

  const daily: DailyPoint[] = range.days.map((date) => {
    const plan = committed.get(date);
    const plannedMinutes = plan
      ? (taskBlocksByPlan.get(plan.id) ?? []).reduce((total, block) => total + minutesOf(block.end_time) - minutesOf(block.start_time), 0)
      : null;
    return { date, plannedMinutes, loggedMinutes: sum(entries.filter((entry) => entry.date === date)) };
  });

  // Completion rate: each task once per finished committed plan day.
  // Today is excluded until it is over, so the rate does not dip every morning.
  let planned = 0;
  let completedOnTime = 0;
  let daysCounted = 0;
  const missedPlanned: AnalyticsResult["missedPlanned"] = [];
  for (const [date, plan] of [...committed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (date >= today) continue;
    daysCounted += 1;
    for (const taskId of new Set((taskBlocksByPlan.get(plan.id) ?? []).map((block) => block.task_id as string))) {
      planned += 1;
      const task = taskById.get(taskId);
      if (task?.status === "completed" && task.completed_at && localDate(task.completed_at) <= date) completedOnTime += 1;
      else missedPlanned.push({ taskId, date });
    }
  }

  // Logged time by category; sums to loggedMinutes by construction.
  const categories = groupTotals(entries.map((entry) => ({ raw: taskById.get(entry.taskId)?.category ?? null, amount: entry.minutes })), "Uncategorized")
    .filter((bar) => bar.value > 0);

  // Streaks of days with at least one completed task.
  const completionDays = new Set(input.tasks.filter((task) => task.status === "completed" && task.completed_at).map((task) => localDate(task.completed_at as string)));
  let current = 0;
  for (let day = completionDays.has(today) ? today : addDaysToISODate(today, -1); completionDays.has(day); day = addDaysToISODate(day, -1)) current += 1;
  let longestInRange = 0;
  let run = 0;
  for (const day of range.days) {
    run = completionDays.has(day) ? run + 1 : 0;
    longestInRange = Math.max(longestInRange, run);
  }

  // Tasks currently skipped or deferred whose last update falls in range.
  // There is no status history, so this is not every past skip or deferral.
  const shelved = input.tasks.filter((task) => (task.status === "skipped" || task.status === "deferred") && inRange.has(localDate(task.updated_at)));
  const grouped = groupTotals(shelved.map((task) => ({ raw: task.status_reason, amount: 1 })), "No reason given");
  const reasons = grouped.length > TOP_REASONS
    ? [...grouped.slice(0, TOP_REASONS), { label: "Other", value: grouped.slice(TOP_REASONS).reduce((total, bar) => total + bar.value, 0) }]
    : grouped;

  // Goal progress counts tasks linked directly or through their project or milestone.
  const projectGoal = new Map(input.projects.map((project) => [project.id, project.goal_id]));
  const milestoneProject = new Map(input.milestones.map((milestone) => [milestone.id, milestone.project_id]));
  const goalOf = (task: AnalyticsTask): string | null =>
    task.goal_id
    ?? (task.project_id ? projectGoal.get(task.project_id) ?? null : null)
    ?? (task.milestone_id ? projectGoal.get(milestoneProject.get(task.milestone_id) ?? "") ?? null : null);

  const goals = input.goals
    .filter((goal) => goal.status === "active")
    .map((goal) => progress(goal.id, goal.title, input.tasks.filter((task) => goalOf(task) === goal.id)))
    .sort((a, b) => a.title.localeCompare(b.title));
  const milestones = input.milestones
    .filter((milestone) => milestone.status === "active")
    .map((milestone) => ({ ...progress(milestone.id, milestone.title, input.tasks.filter((task) => task.milestone_id === milestone.id)), dueDate: milestone.due_date }))
    .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || a.title.localeCompare(b.title));

  return {
    loggedMinutes: sum(entries),
    timerMinutes: sum(entries.filter((entry) => entry.source === "timer")),
    manualMinutes: sum(entries.filter((entry) => entry.source === "manual")),
    daily,
    completion: { planned, completedOnTime, rate: planned ? completedOnTime / planned : null, daysCounted },
    missedPlanned,
    categories,
    overdueCount: input.tasks.filter((task) => OPEN_TASK_STATUSES.has(task.status) && task.due_date !== null && task.due_date < today).length,
    streak: { current, longestInRange },
    reasons,
    reasonTaskCount: shelved.length,
    goals,
    milestones,
    excluded,
  };
}
