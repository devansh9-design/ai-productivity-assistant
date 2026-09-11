import type { EnergyLevel } from "@/lib/types";

const ENERGY_LEVELS: EnergyLevel[] = ["low", "medium", "high"];
const TEXT_LIMITS = {
  distractions: 2000,
  wins: 2000,
  lesson: 2000,
  reflection: 5000,
} as const;

export interface TelegramCheckinInput {
  chatId: string;
  mood: number;
  energyLevel: EnergyLevel | null;
  distractions: string | null;
  wins: string | null;
  lesson: string | null;
  reflection: string;
  timeZone: string;
}

export class TelegramCheckinValidationError extends Error {}

function optionalText(value: unknown, field: keyof typeof TEXT_LIMITS): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new TelegramCheckinValidationError(`${field} must be a string.`);
  }

  const text = value.trim();
  if (text.length > TEXT_LIMITS[field]) {
    throw new TelegramCheckinValidationError(`${field} must be ${TEXT_LIMITS[field]} characters or fewer.`);
  }
  return text || null;
}

function parseChatId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^-?(?:0|[1-9]\d*)$/.test(value.trim())) return value.trim();
  throw new TelegramCheckinValidationError("chat_id must be a Telegram chat ID.");
}

function parseMood(value: unknown): number {
  const mood =
    typeof value === "number" && Number.isInteger(value)
      ? value
      : typeof value === "string" && /^[1-5]$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;

  if (mood < 1 || mood > 5 || !Number.isInteger(mood)) {
    throw new TelegramCheckinValidationError("Mood must be a number from 1 to 5.");
  }
  return mood;
}

function parseEnergyLevel(value: unknown): EnergyLevel | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new TelegramCheckinValidationError("energy_level must be low, medium, or high.");
  }

  const energyLevel = value.trim().toLowerCase();
  if (!ENERGY_LEVELS.includes(energyLevel as EnergyLevel)) {
    throw new TelegramCheckinValidationError("energy_level must be low, medium, or high.");
  }
  return energyLevel as EnergyLevel;
}

export function parseTelegramCheckinPayload(payload: unknown): TelegramCheckinInput {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TelegramCheckinValidationError("Request body must be a JSON object.");
  }

  const data = payload as Record<string, unknown>;
  const reflection = optionalText(data.reflection, "reflection");
  if (!reflection) throw new TelegramCheckinValidationError("reflection is required.");

  if (data.time_zone !== undefined && typeof data.time_zone !== "string") {
    throw new TelegramCheckinValidationError("time_zone must be an IANA timezone string.");
  }

  return {
    chatId: parseChatId(data.chat_id),
    mood: parseMood(data.mood),
    energyLevel: parseEnergyLevel(data.energy_level),
    distractions: optionalText(data.distractions, "distractions"),
    wins: optionalText(data.wins, "wins"),
    lesson: optionalText(data.lesson, "lesson"),
    reflection,
    timeZone: data.time_zone?.trim() || "UTC",
  };
}
