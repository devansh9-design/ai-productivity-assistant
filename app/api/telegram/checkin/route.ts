import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveCheckinInput } from "@/lib/checkins/validate";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";

export const runtime = "nodejs";

function normalizeEnergy(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["low", "medium", "high"].includes(normalized)) return normalized;

  const rating = Number.parseInt(normalized, 10);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  if (rating <= 2) return "low";
  if (rating === 3) return "medium";
  return "high";
}

/**
 * Receives a parsed Telegram evening check-in from n8n.
 * Authentication is handled by a shared webhook secret. The actual database
 * write is performed by a Supabase SECURITY DEFINER RPC so this endpoint
 * does not require the server-only service-role key.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_CHECKIN_WEBHOOK_SECRET;
  const suppliedSecret = request.headers.get("x-telegram-checkin-secret");

  if (!secret || !suppliedSecret || suppliedSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    chat_id?: number | string;
    mood?: number | string | null;
    energy_level?: string | number | null;
    distractions?: string | null;
    wins?: string | null;
    lesson?: string | null;
    reflection?: string | null;
    time_zone?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const chatId = String(body.chat_id ?? "").trim();
  if (!chatId) {
    return NextResponse.json({ error: "chat_id is required" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return NextResponse.json(
      { error: "Supabase public configuration is incomplete" },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const formData = new FormData();
  formData.set("reflection", String(body.reflection ?? ""));
  if (body.mood !== null && body.mood !== undefined) {
    formData.set("mood", String(body.mood));
  }

  const energy = normalizeEnergy(
    body.energy_level === null || body.energy_level === undefined
      ? null
      : String(body.energy_level),
  );
  if (energy) formData.set("energy_level", energy);
  if (body.distractions) formData.set("distractions", body.distractions);
  if (body.wins) formData.set("wins", body.wins);
  if (body.lesson) formData.set("lesson", body.lesson);

  let input;
  try {
    input = resolveCheckinInput(formData);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid check-in" },
      { status: 400 },
    );
  }

  const timeZone = body.time_zone?.trim() || DEFAULT_TIMEZONE;
  const checkinDate = getTodayISODate(timeZone);

  const { data, error } = await supabase.rpc("telegram_checkin", {
    p_chat_id: chatId,
    p_checkin_date: checkinDate,
    p_mood: input.mood,
    p_energy_level: input.energy_level,
    p_distractions: input.distractions,
    p_wins: input.wins,
    p_lesson: input.lesson,
    p_reflection: input.reflection,
  });

  if (error) {
    const status = error.message === "Telegram chat is not linked" ? 403 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(data);
}
