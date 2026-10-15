import type { AvailabilityRuleKind, EnergyLevel } from "@/lib/types";

export interface PlanningPreferenceValues {
  bufferPercent: number;
  lowEnergyMaxBlockMinutes: number;
  adaptToActualDurations: boolean;
}

export const DEFAULT_PLANNING_PREFERENCES: PlanningPreferenceValues = {
  bufferPercent: 20,
  lowEnergyMaxBlockMinutes: 45,
  adaptToActualDurations: true,
};

/** Calibration needs this many completed tasks with both an estimate and an actual time. */
export const MIN_DURATION_SAMPLES = 5;
const MIN_DURATION_FACTOR = 0.75;
const MAX_DURATION_FACTOR = 1.5;

function integerInRange(raw: FormDataEntryValue | null, label: string, min: number, max: number): number {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`${label} must be a whole number.`);
  const value = Number(text);
  if (value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}

/** Validates the Settings form; throws a user-facing message on invalid input. */
export function parsePlanningPreferencesForm(formData: Pick<FormData, "get">): PlanningPreferenceValues {
  return {
    bufferPercent: integerInRange(formData.get("buffer_percent"), "Buffer", 0, 50),
    lowEnergyMaxBlockMinutes: integerInRange(formData.get("low_energy_max_block_minutes"), "Low-energy session length", 15, 240),
    adaptToActualDurations: formData.get("adapt_to_actual_durations") === "on",
  };
}

export interface DurationSample {
  estimated_minutes: number | null;
  actual_minutes: number | null;
}

/**
 * Learns how long work really takes relative to its estimate, as the ratio of
 * total actual to total estimated minutes over completed tasks. Returns 1 when
 * there is too little history; otherwise clamps to 0.75-1.5 and rounds to 0.05
 * so one unusual task cannot swing the whole plan.
 */
export function computeDurationFactor(samples: DurationSample[]): { factor: number; sampleSize: number } {
  const usable = samples.filter((sample) => (sample.estimated_minutes ?? 0) > 0 && (sample.actual_minutes ?? 0) > 0);
  if (usable.length < MIN_DURATION_SAMPLES) return { factor: 1, sampleSize: usable.length };
  const totalEstimated = usable.reduce((sum, sample) => sum + (sample.estimated_minutes as number), 0);
  const totalActual = usable.reduce((sum, sample) => sum + (sample.actual_minutes as number), 0);
  const clamped = Math.min(MAX_DURATION_FACTOR, Math.max(MIN_DURATION_FACTOR, totalActual / totalEstimated));
  return { factor: Math.round(clamped * 20) / 20, sampleSize: usable.length };
}

export interface PreferenceSummaryInput {
  preferences: PlanningPreferenceValues;
  durationFactor: number;
  todayRules: Array<{ kind: AvailabilityRuleKind | string; start_time: string; end_time: string }>;
  recentEnergy: Array<EnergyLevel | null>;
  insights: string[];
}

const RESERVATION_LABELS: Record<string, string> = {
  sleep: "sleep",
  meal: "meal",
  travel: "travel",
  break: "break",
  exercise: "gym/exercise",
};

function range(rule: { start_time: string; end_time: string }): string {
  return `${rule.start_time.slice(0, 5)}-${rule.end_time.slice(0, 5)}`;
}

/**
 * Renders settings, recent check-in energy, and observed patterns as a short
 * plain-text block for the AI context. It describes the user; it never
 * contains instructions.
 */
export function buildPreferenceSummary(input: PreferenceSummaryInput): string {
  const { preferences, durationFactor, todayRules, recentEnergy, insights } = input;
  const lines = [
    `Buffer: ${preferences.bufferPercent}% of free working time is kept unscheduled.`,
    `Low-energy work sessions are capped at ${preferences.lowEnergyMaxBlockMinutes} minutes.`,
    durationFactor === 1
      ? "Task estimates are used as entered."
      : `Task estimates are scaled x${durationFactor.toFixed(2)} to match how long completed work actually took.`,
  ];

  const focus = todayRules.filter((rule) => rule.kind === "high_focus");
  lines.push(focus.length ? `High-focus windows today: ${focus.map(range).join(", ")}.` : "No high-focus window is set for today.");

  const reserved = todayRules.filter((rule) => rule.kind in RESERVATION_LABELS);
  if (reserved.length) lines.push(`Reserved today: ${reserved.map((rule) => `${RESERVATION_LABELS[rule.kind]} ${range(rule)}`).join(", ")}.`);

  const energies = recentEnergy.filter((level): level is EnergyLevel => level !== null);
  if (energies.length) {
    const count = (level: EnergyLevel) => energies.filter((value) => value === level).length;
    lines.push(`Recent check-in energy (last ${energies.length}): ${count("low")} low, ${count("medium")} medium, ${count("high")} high.`);
  } else {
    lines.push("No recent check-in energy is recorded.");
  }

  for (const insight of insights.slice(0, 3)) lines.push(`Observed: ${insight}`);
  return lines.join("\n");
}
