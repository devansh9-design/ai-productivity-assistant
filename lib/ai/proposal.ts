export const PROPOSAL_TYPES = [
  "get_today_context",
  "suggest_schedule",
  "propose_reschedule",
  "propose_task_draft",
  "summarize_day",
] as const;

export type ProposalType = (typeof PROPOSAL_TYPES)[number];

export type ProposalItem = {
  task_id?: string;
  title?: string;
  reason: string;
  start_time?: string;
  end_time?: string;
  estimated_minutes?: number;
};

export type PlanningProposal = {
  type: ProposalType;
  summary: string;
  reason: string;
  items: ProposalItem[];
};

export function isProposalType(value: unknown): value is ProposalType {
  return typeof value === "string" &&
    (PROPOSAL_TYPES as readonly string[]).includes(value);
}
