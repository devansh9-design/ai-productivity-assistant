import type { EnergyLevel } from "@/lib/types";

const ENERGY_LEVELS: EnergyLevel[] = ["low", "medium", "high"];

function optionalText(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function optionalMinutes(formData: FormData, key: string) {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function scoreValue(formData: FormData, key: string) {
  const parsed = Number.parseInt(String(formData.get(key) ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : 3;
}

function isEnergyLevel(value: string | null): value is EnergyLevel {
  return !!value && ENERGY_LEVELS.includes(value as EnergyLevel);
}

export interface TaskSchedulingMetadataUpdate {
  urgency: number;
  impact: number;
  must_do: boolean;
  energy_level: EnergyLevel | null;
  estimated_minutes: number | null;
}

/**
 * Normalizes the editable scheduling fields for an existing task.
 * The returned object is intentionally limited to scheduling metadata
 * so the save path cannot accidentally overwrite unrelated columns.
 */
export function buildTaskSchedulingMetadataUpdate(formData: FormData): TaskSchedulingMetadataUpdate {
  const energyLevel = optionalText(formData, "energy_level");

  return {
    urgency: scoreValue(formData, "urgency"),
    impact: scoreValue(formData, "impact"),
    must_do: formData.get("must_do") === "on",
    energy_level: isEnergyLevel(energyLevel) ? energyLevel : null,
    estimated_minutes: optionalMinutes(formData, "estimated_minutes"),
  };
}
