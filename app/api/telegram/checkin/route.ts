import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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

  const moodRaw =
    body.mood === null || body.mood === undefined ? "" : String(body.mood).trim();

  let mood: number | null = null;
  if (moodRaw) {
    const parsed = Number.parseInt(moodRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      return NextResponse.json(
        { error: "Mood must be a number from 1 to 5." },
        { status: 400 },
      );
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
    [wins, lesson, distractions].filter(Boolean).join(" | ");

  if (reflection.length > 5000) {
    return NextResponse.json(
      { error: "Reflection must be 5000 characters or fewer." },
      { status: 400 },
    );
  }

  const timeZone = text(body.time_zone) || DEFAULT_TIMEZONE;
  const checkinDate = getTodayISODate(timeZone);

  try {
    // Do not call the Telegram check-in RPC here. The previous RPC call was
    // timing out at the database statement level. This route performs the
    // two small writes directly with the server-only service-role client.
    const supabase = createServiceRoleClient();

    const { data: mapping, error: mappingError } = await supabase
      .from("telegram_chat_mappings")
      .select("user_id")
      .eq("chat_id", chatId)
      .maybeSingle();

    if (mappingError) {
      console.error("telegram checkin mapping lookup failed", mappingError);
      return NextResponse.json(
        { error: mappingError.message },
        { status: 500 },
      );
    }

    if (!mapping?.user_id) {
      return NextResponse.json(
        { error: "Telegram chat is not linked" },
        { status: 403 },
      );
    }

    const { data: checkin, error: checkinError } = await supabase
      .from("checkins")
      .upsert(
        {
          user_id: mapping.user_id,
          checkin_date: checkinDate,
          type: "evening",
          mood,
          energy_level: energyLevel,
          distractions,
          wins,
          lesson,
        },
        { onConflict: "user_id,checkin_date,type" },
      )
      .select("id, checkin_date")
      .single();

    if (checkinError) {
      console.error("telegram checkin upsert failed", checkinError);
      return NextResponse.json(
        { error: checkinError.message },
        { status: 500 },
      );
    }

    // Journal entries are optional for a check-in. Avoid inserting an empty
    // reflection because journal_entries.reflection is NOT NULL and must be
    // at least one character long.
    if (reflection) {
      const { error: journalError } = await supabase
        .from("journal_entries")
        .upsert(
          {
            user_id: mapping.user_id,
            entry_date: checkinDate,
            checkin_id: checkin.id,
            reflection,
          },
          { onConflict: "user_id,entry_date" },
        );

      if (journalError) {
        console.error("telegram journal upsert failed", journalError);
        return NextResponse.json(
          { error: journalError.message },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      ok: true,
      checkin_id: checkin.id,
      checkin_date: checkin.checkin_date,
    });
  } catch (error) {
    console.error("telegram checkin request failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Telegram check-in failed",
      },
      { status: 500 },
    );
  }
}
