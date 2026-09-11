import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { TelegramCheckinValidationError, parseTelegramCheckinPayload } from "@/lib/telegram/checkin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getTodayISODate } from "@/lib/tasks/timezone";

export const runtime = "nodejs";

function hasValidSecret(request: Request): boolean {
  const expected = process.env.TELEGRAM_CHECKIN_WEBHOOK_SECRET;
  const provided = request.headers.get("x-telegram-checkin-secret");
  if (!expected || !provided || expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function POST(request: Request) {
  if (!hasValidSecret(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const input = parseTelegramCheckinPayload(payload);
    const checkinDate = getTodayISODate(input.timeZone);
    const supabase = createServiceRoleClient();

    const { data: mapping, error: mappingError } = await supabase
      .from("telegram_chat_mappings")
      .select("user_id")
      .eq("chat_id", input.chatId)
      .maybeSingle();
    if (mappingError) throw mappingError;
    if (!mapping) {
      return NextResponse.json({ error: "Telegram chat is not linked to an account." }, { status: 404 });
    }

    const { data: checkin, error: checkinError } = await supabase
      .from("checkins")
      .upsert(
        {
          user_id: mapping.user_id,
          checkin_date: checkinDate,
          type: "evening",
          mood: input.mood,
          energy_level: input.energyLevel,
          distractions: input.distractions,
          wins: input.wins,
          lesson: input.lesson,
        },
        { onConflict: "user_id,checkin_date,type" },
      )
      .select("id")
      .single();
    if (checkinError) throw checkinError;

    const { error: journalError } = await supabase.from("journal_entries").upsert(
      {
        user_id: mapping.user_id,
        entry_date: checkinDate,
        checkin_id: checkin.id,
        reflection: input.reflection,
      },
      { onConflict: "user_id,entry_date" },
    );
    if (journalError) throw journalError;

    return NextResponse.json({ checkin_id: checkin.id, checkin_date: checkinDate });
  } catch (error) {
    if (error instanceof TelegramCheckinValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Telegram check-in failed", error);
    return NextResponse.json({ error: "Unable to save check-in." }, { status: 500 });
  }
}
