import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";

export const runtime = "nodejs";

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

  const chatId = text(body.chat_id);
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

  const timeZone = text(body.time_zone) || DEFAULT_TIMEZONE;
  const requestedDate = text(body.plan_date);
  const planDate = requestedDate || getTodayISODate(timeZone);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
    return NextResponse.json(
      { error: "plan_date must use YYYY-MM-DD format." },
      { status: 400 },
    );
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.rpc("telegram_today", {
    p_chat_id: chatId,
    p_plan_date: planDate,
  });

  if (error) {
    const status = error.message === "Telegram chat is not linked" ? 403 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(data);
}
