import "server-only";

import type { DailyPlan, FixedCommitment, Goal, JournalEntry, Milestone, PlanBlock, Project, Task, Checkin } from "@/lib/types";

export const AI_PROPOSAL_TYPES = [
  "get_today_context",
  "suggest_schedule",
  "propose_reschedule",
  "propose_task_draft",
  "summarize_day",
] as const;

export type AiProposalType = (typeof AI_PROPOSAL_TYPES)[number];

export interface AiProposal {
  proposal_type: AiProposalType;
  summary: string;
  rationale: string;
  actions: Array<{
    type: "schedule_task" | "reschedule_task" | "draft_task" | "none";
    task_id: string | null;
    title: string;
    start_time: string | null;
    end_time: string | null;
    estimated_minutes: number | null;
    due_date: string | null;
    priority: "low" | "medium" | "high" | "urgent" | null;
    description: string | null;
  }>;
  warnings: string[];
  requires_confirmation: boolean;
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["proposal_type", "summary", "rationale", "actions", "warnings", "requires_confirmation"],
  properties: {
    proposal_type: { type: "string", enum: AI_PROPOSAL_TYPES },
    summary: { type: "string", minLength: 1, maxLength: 1000 },
    rationale: { type: "string", minLength: 1, maxLength: 2000 },
    actions: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type","task_id","title","start_time","end_time","estimated_minutes","due_date","priority","description"],
        properties: {
          type: { type: "string", enum: ["schedule_task","reschedule_task","draft_task","none"] },
          task_id: { type: ["string","null"] },
          title: { type: "string" },
          start_time: { type: ["string","null"] },
          end_time: { type: ["string","null"] },
          estimated_minutes: { type: ["integer","null"] },
          due_date: { type: ["string","null"] },
          priority: { type: ["string","null"], enum: ["low","medium","high","urgent",null] },
          description: { type: ["string","null"] },
        },
      },
    },
    warnings: { type: "array", maxItems: 10, items: { type: "string" } },
    requires_confirmation: { type: "boolean" },
  },
} as const;

export function aiProposalSchema() {
  return schema;
}

export function validateAiProposal(value: unknown): AiProposal {
  if (!value || typeof value !== "object") throw new Error("AI returned an invalid proposal.");
  const p = value as Record<string, unknown>;
  if (!AI_PROPOSAL_TYPES.includes(p.proposal_type as AiProposalType)) throw new Error("AI returned an unsupported proposal type.");
  if (typeof p.summary !== "string" || typeof p.rationale !== "string") throw new Error("AI returned an invalid proposal.");
  if (!Array.isArray(p.actions) || !Array.isArray(p.warnings) || typeof p.requires_confirmation !== "boolean") {
    throw new Error("AI returned an invalid proposal.");
  }
  return value as AiProposal;
}

export function buildAiContext(input: {
  date: string;
  timeZone: string;
  message: string;
  tasks: Task[];
  plans: DailyPlan[];
  blocks: PlanBlock[];
  commitments: FixedCommitment[];
  goals: Goal[];
  projects: Project[];
  milestones: Milestone[];
  checkins: Checkin[];
  journals: JournalEntry[];
  calendarEvents: Array<{ googleEventId: string; title: string; startTime: string; endTime: string }>;
}) {
  return {
    date: input.date,
    time_zone: input.timeZone,
    user_request: input.message,
    incomplete_tasks: input.tasks.filter((t) => t.status !== "completed").slice(0, 50).map((t) => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority, urgency: t.urgency,
      impact: t.impact, must_do: t.must_do, estimated_minutes: t.estimated_minutes,
      due_date: t.due_date, energy_level: t.energy_level,
    })),
    current_plans: input.plans.slice(0, 3).map((p) => ({ id: p.id, date: p.plan_date, status: p.status, version: p.version })),
    current_plan_blocks: input.blocks.map((b) => ({ task_id: b.task_id, kind: b.kind, title: b.title, start_time: b.start_time, end_time: b.end_time, is_manual: b.is_manual })),
    fixed_commitments: input.commitments.map((c) => ({ title: c.title, start_time: c.start_time, end_time: c.end_time })),
    calendar_events: input.calendarEvents.map((e) => ({ title: e.title, start_time: e.startTime, end_time: e.endTime })),
    goals: input.goals.filter((g) => g.status === "active").slice(0, 20).map((g) => ({ id: g.id, title: g.title, description: g.description })),
    projects: input.projects.filter((p) => p.status === "active").slice(0, 20).map((p) => ({ id: p.id, title: p.title, goal_id: p.goal_id })),
    milestones: input.milestones.filter((m) => m.status === "active").slice(0, 20).map((m) => ({ id: m.id, title: m.title, due_date: m.due_date, project_id: m.project_id })),
    recent_checkins: input.checkins.slice(0, 7).map((c) => ({ date: c.checkin_date, mood: c.mood, energy_level: c.energy_level, distractions: c.distractions, wins: c.wins, lesson: c.lesson })),
    recent_reflections: input.journals.slice(0, 7).map((j) => ({ date: j.entry_date, reflection: j.reflection })),
  };
}

export const AI_INSTRUCTIONS = `You are the planning assistant inside a personal productivity application.
Use only the supplied user context. Do not invent tasks, calendar events, goals, accomplishments, or availability.
The deterministic scheduler and Google Calendar are the source of truth for actual schedule writes.
You may propose actions, but you never perform writes yourself.
Completed tasks must never be modified.
Fixed commitments and calendar events are immutable and must not be scheduled over.
If the user asks for a schedule, propose at most three must-do tasks and respect known calendar blocks.
If the user asks to create a task, propose a draft only.
Every proposal must explain its rationale and warnings.
For schedule proposals, use local HH:mm times in the supplied timezone and only times supported by the supplied availability/context.
Set requires_confirmation=true whenever actions are present.`;
