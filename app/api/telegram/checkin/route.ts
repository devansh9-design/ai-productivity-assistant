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
 * This endpoint is intentionally protected by a shared secret and maps the
 * Telegram chat ID to the app user before writing to Supabase.
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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server configuration is incomplete" }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: mapping, error: mappingError } = await admin
    .from("telegram_chat_mappings")
    .select("user_id")
    .eq("chat_id", chatId)
    .maybeSingle();

  if (mappingError) {
    return NextResponse.json({ error: mappingError.message }, { status: 500 });
  }
  if (!mapping) {
    return NextResponse.json({ error: "Telegram chat is not linked" }, { status: 403 });
  }

  const formData = new FormData();
  formData.set("reflection", String(body.reflection ?? ""));
  if (body.mood !== null && body.mood !== undefined) formData.set("mood", String(body.mood));
  const energy = normalizeEnergy(body.energy_level === null || body.energy_level === undefined ? null : String(body.energy_level));
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

  const { data: checkin, error: checkinError } = await admin
    .from("checkins")
    .upsert(
      {
        user_id: mapping.user_id,
        checkin_date: checkinDate,
        type: "evening",
        mood: input.mood,
        energy_level: input.energy_level,
        distractions: input.distractions,
        wins: input.wins,
        lesson: input.lesson,
      },
      { onConflict: "user_id,checkin_date,type" },
    )
    .select("id")
    .single();

  if (checkinError) {
    return NextResponse.json({ error: checkinError.message }, { status: 500 });
  }

  const { error: journalError } = await admin.from("journal_entries").upsert(
    {
      user_id: mapping.user_id,
      entry_date: checkinDate,
      checkin_id: checkin.id,
      reflection: input.reflection,
    },
    { onConflict: "user_id,entry_date" },
  );

  if (journalError) {
    return NextResponse.json({ error: journalError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, checkin_id: checkin.id, checkin_date: checkinDate });
}
