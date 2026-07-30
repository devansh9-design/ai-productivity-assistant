export type EntityStatus = "active" | "completed" | "archived";

export type TaskStatus = "todo" | "in_progress" | "completed" | "skipped" | "deferred";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type EnergyLevel = "low" | "medium" | "high";

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
  estimated_minutes: number | null;
  actual_minutes: number | null;
  due_date: string | null;
  energy_level: EnergyLevel | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}
