import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

function text(value: unknown) {
  const v = String(value ?? "").trim();
  return v || null;
}

export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_CHECKIN_WEBHOOK_SECRET;
  const suppliedSecret = request.headers.get("x-telegram-checkin-secret");

  if (!secret || !suppliedSecret || suppliedSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
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

  const moodRaw = body.mood === null || body.mood === undefined ? "" : String(body.mood).trim();
  let mood: number | null = null;
  if (moodRaw) {
    const parsed = Number.parseInt(moodRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      return NextResponse.json({ error: "Mood must be a number from 1 to 5." }, { status: 400 });
    }
    mood = parsed;
  }

  const energyLevel = normalizeEnergy(
    body.energy_level === null || body.energy_level === undefined
      ? null
      : String(body.energy_level),
  );

  const distractions = text(body.distractions);
  const wins = text(body.wins);
  const lesson = text(body.lesson);
  const reflection =
    text(body.reflection) ??
    [wins, lesson, distractions].filter(Boolean).join(" | ") ??
    "";

  if (reflection.length > 5000) {
    return NextResponse.json({ error: "Reflection must be 5000 characters or fewer." }, { status: 400 });
  }

  const timeZone = text(body.time_zone) || DEFAULT_TIMEZONE;
  const checkinDate = getTodayISODate(timeZone);

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.rpc("telegram_checkin", {
    p_chat_id: chatId,
    p_checkin_date: checkinDate,
    p_mood: mood,
    p_energy_level: energyLevel,
    p_distractions: distractions,
    p_wins: wins,
    p_lesson: lesson,
    p_reflection: reflection,
  });

  if (error) {
    const status = error.message === "Telegram chat is not linked" ? 403 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(data);
}
