import type { EnergyLevel } from "@/lib/types";

const ENERGY_LEVELS: EnergyLevel[] = ["low", "medium", "high"];

// Must match the checkins table's char_length(...) <= 2000 constraints and
// journal_entries' reflection <= 5000 constraint. Validating the same limit
// here means a too-long value gets a friendly message before it ever
// reaches the database — the DB constraint stays as the last line of
// defense, not the only one.
export const DISTRACTIONS_MAX_LENGTH = 2000;
export const WINS_MAX_LENGTH = 2000;
export const LESSON_MAX_LENGTH = 2000;
export const REFLECTION_MAX_LENGTH = 5000;

export interface CheckinInput {
  reflection: string;
  mood: number | null;
  energy_level: EnergyLevel | null;
  distractions: string | null;
  wins: string | null;
  lesson: string | null;
}

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function checkMaxLength(label: string, value: string | null, maxLength: number) {
  if (value && value.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return value;
}

/**
 * Validates and normalizes the evening check-in form. A reflection is
 * required (it's the thing the acceptance criteria actually checks is
 * "saved and visible later"); everything else is optional structured
 * context. Mood must be an integer 1-5 when provided at all.
 */
export function resolveCheckinInput(formData: FormData): CheckinInput {
  const reflection = String(formData.get("reflection") ?? "").trim();
  if (!reflection) throw new Error("A reflection is required to save the check-in.");
  checkMaxLength("Reflection", reflection, REFLECTION_MAX_LENGTH);

  const moodRaw = String(formData.get("mood") ?? "").trim();
  let mood: number | null = null;
  if (moodRaw) {
    const parsed = Number.parseInt(moodRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      throw new Error("Mood must be a number from 1 to 5.");
    }
    mood = parsed;
  }

  const energyRaw = optionalText(formData.get("energy_level"));
  const energy_level = energyRaw && ENERGY_LEVELS.includes(energyRaw as EnergyLevel) ? (energyRaw as EnergyLevel) : null;

  const distractions = checkMaxLength(
    "Distractions",
    optionalText(formData.get("distractions")),
    DISTRACTIONS_MAX_LENGTH,
  );
  const wins = checkMaxLength("Wins", optionalText(formData.get("wins")), WINS_MAX_LENGTH);
  const lesson = checkMaxLength("Lesson", optionalText(formData.get("lesson")), LESSON_MAX_LENGTH);

  return { reflection, mood, energy_level, distractions, wins, lesson };
}
