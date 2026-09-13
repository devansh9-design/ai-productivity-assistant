import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { TIMEZONE_COOKIE_NAME, DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";
import { getValidAccessToken } from "@/lib/google/oauth";
import { fetchCalendarEvents } from "@/lib/google/calendar";

export type AIPlanningContext = {
  date: string;
  timezone: string;
  preferences: { email: string | null };
  plan: {
    id: string; version: number; status: string; buffer_minutes: number;
    blocks: Array<{ task_id: string | null; kind: string; title: string; start_time: string; end_time: string; is_manual: boolean }>;
    unscheduled: Array<{ task_id: string; reason: string }>;
  } | null;
  calendar: {
    connected: boolean;
    events: Array<{ googleEventId: string; title: string; startTime: string; endTime: string }>;
  };
  incomplete_tasks: Array<{
    id: string; title: string; description: string | null; status: string; priority: string;
    due_date: string | null; estimated_minutes: number | null; energy_level: string | null;
    goal_id: string | null; project_id: string | null; milestone_id: string | null;
  }>;
  goals: Array<{ id: string; title: string; description: string | null; status: string; incomplete_task_count: number }>;
  milestones: Array<{ id: string; title: string; description: string | null; due_date: string | null; status: string; incomplete_task_count: number }>;
  recent_checkins: Array<{
    date: string; mood: number | null; energy_level: string | null; wins: string | null;
    lesson: string | null; distractions: string | null; reflection: string | null;
  }>;
};

export async function getAIPlanningContext(): Promise<AIPlanningContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const cookieStore = await cookies();
  const timezone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); }
  catch { throw new Error("Invalid timezone"); }
  const date = getTodayISODate(timezone);

  const [profileResult, tasksResult, goalsResult, milestonesResult, planResult, checkinsResult, journalsResult] =
    await Promise.all([
      supabase.from("profiles").select("email").eq("id", user.id).maybeSingle(),
      supabase.from("tasks")
        .select("id,title,description,status,priority,due_date,estimated_minutes,energy_level,goal_id,project_id,milestone_id")
        .neq("status", "completed").neq("status", "skipped")
        .order("due_date", { ascending: true }).limit(100),
      supabase.from("goals").select("id,title,description,status").order("created_at", { ascending: true }).limit(50),
      supabase.from("milestones").select("id,title,description,due_date,status").order("due_date", { ascending: true }).limit(100),
      supabase.from("daily_plans").select("id,version,status,buffer_minutes")
        .eq("plan_date", date).in("status", ["draft", "confirmed"])
        .order("version", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("checkins").select("id,checkin_date,mood,energy_level,wins,lesson,distractions")
        .eq("type", "evening").order("checkin_date", { ascending: false }).limit(7),
      supabase.from("journal_entries").select("entry_date,reflection")
        .order("entry_date", { ascending: false }).limit(7),
    ]);

  const firstError = profileResult.error ?? tasksResult.error ?? goalsResult.error ??
    milestonesResult.error ?? planResult.error ?? checkinsResult.error ?? journalsResult.error;
  if (firstError) throw new Error("Could not load AI context: " + firstError.message);

  const tasks = tasksResult.data ?? [];
  const goalCounts = new Map<string, number>();
  const milestoneCounts = new Map<string, number>();
  for (const task of tasks) {
    if (task.goal_id) goalCounts.set(task.goal_id, (goalCounts.get(task.goal_id) ?? 0) + 1);
    if (task.milestone_id) milestoneCounts.set(task.milestone_id, (milestoneCounts.get(task.milestone_id) ?? 0) + 1);
  }

  let plan: AIPlanningContext["plan"] = null;
  if (planResult.data) {
    const [blocksResult, unscheduledResult] = await Promise.all([
      supabase.from("plan_blocks").select("task_id,kind,title,start_time,end_time,is_manual")
        .eq("daily_plan_id", planResult.data.id).order("start_time", { ascending: true }),
      supabase.from("plan_unscheduled_tasks").select("task_id,reason").eq("daily_plan_id", planResult.data.id),
    ]);
    if (blocksResult.error || unscheduledResult.error) {
      throw new Error("Could not load today's plan: " +
        (blocksResult.error?.message ?? unscheduledResult.error?.message));
    }
    plan = { ...planResult.data, blocks: blocksResult.data ?? [], unscheduled: unscheduledResult.data ?? [] };
  }

  let calendar: AIPlanningContext["calendar"] = { connected: false, events: [] };
  const tokenResult = await getValidAccessToken(user.id);
  if (!("error" in tokenResult)) {
    try {
      calendar = { connected: true, events: await fetchCalendarEvents(tokenResult.token, date, timezone) };
    } catch { /* Never claim availability when sync failed. */ }
  }

  const journalsByDate = new Map(
    (journalsResult.data ?? []).map((entry) => [entry.entry_date, entry.reflection]),
  );

  return {
    date, timezone,
    preferences: { email: profileResult.data?.email ?? null },
    plan, calendar, incomplete_tasks: tasks,
    goals: (goalsResult.data ?? []).map((goal) => ({
      ...goal, incomplete_task_count: goalCounts.get(goal.id) ?? 0,
    })),
    milestones: (milestonesResult.data ?? []).map((milestone) => ({
      ...milestone, incomplete_task_count: milestoneCounts.get(milestone.id) ?? 0,
    })),
    recent_checkins: (checkinsResult.data ?? []).map((checkin) => ({
      date: checkin.checkin_date, mood: checkin.mood, energy_level: checkin.energy_level,
      wins: checkin.wins, lesson: checkin.lesson, distractions: checkin.distractions,
      reflection: journalsByDate.get(checkin.checkin_date) ?? null,
    })),
  };
}
