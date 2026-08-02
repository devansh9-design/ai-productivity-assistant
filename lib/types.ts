export type EntityStatus = "active" | "completed" | "archived";

export type TaskStatus = "todo" | "in_progress" | "completed" | "skipped" | "deferred";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type EnergyLevel = "low" | "medium" | "high";

export type AvailabilityRuleKind = "working" | "high_focus" | "sleep" | "meal" | "travel" | "break";
export type PlanBlockKind = "task" | "buffer";

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  goal_id: string | null;
  title: string;
  description: string | null;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
}

export interface Milestone {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  goal_id: string | null;
  project_id: string | null;
  milestone_id: string | null;
  title: string;
  description: string | null;
  category: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  urgency: number;
  impact: number;
  must_do: boolean;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  due_date: string | null;
  energy_level: EnergyLevel | null;
  status_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type CheckinType = "morning" | "evening";

export interface Checkin {
  id: string;
  user_id: string;
  checkin_date: string;
  type: CheckinType;
  mood: number | null;
  energy_level: EnergyLevel | null;
  distractions: string | null;
  wins: string | null;
  lesson: string | null;
  created_at: string;
  updated_at: string;
}

export interface JournalEntry {
  id: string;
  user_id: string;
  entry_date: string;
  checkin_id: string | null;
  reflection: string;
  created_at: string;
  updated_at: string;
}

export interface TaskSession {
  id: string;
  user_id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  minutes: number | null;
  notes: string | null;
  created_at: string;
}

export interface AvailabilityRule {
  id: string;
  user_id: string;
  weekday: number;
  kind: AvailabilityRuleKind;
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
}

export interface FixedCommitment {
  id: string;
  user_id: string;
  commitment_date: string;
  title: string;
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
}

export interface DailyPlan {
  id: string;
  user_id: string;
  plan_date: string;
  buffer_minutes: number;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export interface PlanBlock {
  id: string;
  user_id: string;
  daily_plan_id: string;
  task_id: string | null;
  kind: PlanBlockKind;
  title: string;
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
}

export interface PlanUnscheduledTask {
  id: string;
  user_id: string;
  daily_plan_id: string;
  task_id: string;
  reason: string;
  created_at: string;
}
