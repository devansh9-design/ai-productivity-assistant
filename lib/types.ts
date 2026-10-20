export type EntityStatus = "active" | "completed" | "archived";

export type TaskStatus = "todo" | "in_progress" | "completed" | "skipped" | "deferred";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type EnergyLevel = "low" | "medium" | "high";

export type AvailabilityRuleKind = "working" | "high_focus" | "sleep" | "meal" | "travel" | "break" | "exercise";
export type PlanBlockKind = "task" | "buffer" | "calendar";
export type PlanStatus = "draft" | "publishing" | "publication_failed" | "confirmed" | "superseded" | "completed";

export type GoalCategory = "fitness" | "academics" | "placement" | "skill" | "other";
export type GoalLevel = "beginner" | "intermediate" | "advanced";
export type PlanSource = "ai" | "manual";

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: EntityStatus;
  category: GoalCategory;
  start_date: string | null;
  target_date: string | null;
  weekly_hours: number | null;
  level: GoalLevel | null;
  plan_source: PlanSource | null;
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
  /** Set when the task was created from a routine, for that routine's occurrence_date. */
  routine_id: string | null;
  occurrence_date: string | null;
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
  /** Morning check-in: minutes free today. */
  available_minutes: number | null;
  notes: string | null;
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
  status: PlanStatus;
  version: number;
  parent_plan_id: string | null;
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
  sort_order: number;
  is_manual: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanningPreferences {
  user_id: string;
  buffer_percent: number;
  low_energy_max_block_minutes: number;
  adapt_to_actual_durations: boolean;
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

// ---------------------------------------------------------------------------
// Phase 2: student planner (supabase/migrations/20261020120000_student_planner_model.sql)
// ---------------------------------------------------------------------------

export interface StudentProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  college_year: number | null;
  timezone: string | null;
  onboarded_at: string | null;
}

/** "latest" uses the most recent logged value (e.g. body weight); "sum" adds them up (e.g. problems solved). */
export type MetricAggregation = "sum" | "latest";

export interface GoalMetric {
  id: string;
  user_id: string;
  goal_id: string;
  name: string;
  unit: string | null;
  aggregation: MetricAggregation;
  baseline_value: number | null;
  target_value: number | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export type PhaseStatus = "upcoming" | "active" | "completed";

export interface GoalPhase {
  id: string;
  user_id: string;
  goal_id: string;
  position: number;
  title: string;
  focus: string | null;
  start_date: string;
  end_date: string;
  target_note: string | null;
  status: PhaseStatus;
  created_at: string;
  updated_at: string;
}

export interface WeeklyTarget {
  id: string;
  user_id: string;
  goal_id: string;
  /** Monday of the week. */
  week_start: string;
  title: string;
  goal_metric_id: string | null;
  target_value: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Routine {
  id: string;
  user_id: string;
  goal_id: string | null;
  title: string;
  days_of_week: IsoWeekday[];
  minutes: number;
  preferred_start: string | null;
  preferred_end: string | null;
  energy_level: EnergyLevel | null;
  priority: TaskPriority;
  goal_metric_id: string | null;
  /** How much one session adds to its metric, e.g. 2 problems. */
  metric_amount: number | null;
  start_date: string;
  end_date: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProgressLog {
  id: string;
  user_id: string;
  goal_metric_id: string;
  log_date: string;
  value: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyFeedback {
  id: string;
  user_id: string;
  feedback_date: string;
  source: "ai" | "fallback";
  summary: string;
  /** Adjustment proposals and their outcome; their shape is validated by the app. */
  suggestions: unknown[];
  generated_at: string;
  created_at: string;
  updated_at: string;
}
