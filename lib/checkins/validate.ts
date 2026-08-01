import type { EnergyLevel } from "@/lib/types";

const ENERGY_LEVELS: EnergyLevel[] = ["low", "medium", "high"];

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

/**
 * Validates and normalizes the evening check-in form. A reflection is
 * required (it's the thing the acceptance criteria actually checks is
 * "saved and visible later"); everything else is optional structured
 * context. Mood must be an integer 1-5 when provided at all.
 */
export function resolveCheckinInput(formData: FormData): CheckinInput {
  const reflection = String(formData.get("reflection") ?? "").trim();
  if (!reflection) throw new Error("A reflection is required to save the check-in.");

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

  return {
    reflection,
    mood,
    energy_level,
    distractions: optionalText(formData.get("distractions")),
    wins: optionalText(formData.get("wins")),
    lesson: optionalText(formData.get("lesson")),
  };
}
