import {
  isProposalType,
  type PlanningProposal,
} from "./proposal";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isString(value: unknown, maxLength = 2000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

export function validatePlanningProposal(
  value: unknown,
): { ok: true; data: PlanningProposal } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Proposal must be an object." };
  }

  const p = value as Record<string, unknown>;

  if (!isProposalType(p.type)) {
    return { ok: false, error: "Invalid proposal type." };
  }

  if (!isString(p.summary, 1000)) {
    return { ok: false, error: "Proposal summary is required." };
  }

  if (!isString(p.reason, 2000)) {
    return { ok: false, error: "Proposal reason is required." };
  }

  if (!Array.isArray(p.items) || p.items.length > 50) {
    return { ok: false, error: "Proposal items must be an array of at most 50 items." };
  }

  for (const item of p.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "Each proposal item must be an object." };
    }

    const i = item as Record<string, unknown>;

    if (!isString(i.reason, 2000)) {
      return { ok: false, error: "Each proposal item requires a reason." };
    }

    if (i.task_id !== undefined &&
        (typeof i.task_id !== "string" || !UUID_RE.test(i.task_id))) {
      return { ok: false, error: "task_id must be a valid UUID." };
    }

    for (const key of ["title", "start_time", "end_time"] as const) {
      if (i[key] !== undefined && !isString(i[key], 500)) {
        return { ok: false, error: `${key} must be a non-empty string.` };
      }
    }

    if (
      i.estimated_minutes !== undefined &&
      (typeof i.estimated_minutes !== "number" ||
        !Number.isInteger(i.estimated_minutes) ||
        i.estimated_minutes < 1 ||
        i.estimated_minutes > 1440)
    ) {
      return { ok: false, error: "estimated_minutes must be an integer from 1 to 1440." };
    }
  }

  return { ok: true, data: p as unknown as PlanningProposal };
}
