import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";

export const runtime = "nodejs";

type TelegramPlan = {
  status?: string;
  version?: number | string;
  buffer_minutes?: number | null;
};

type TelegramBlock = {
  kind?: string;
  start_time?: string | null;
  end_time?: string | null;
  title?: string | null;
};

type TelegramUnscheduledTask = {
  estimated_minutes?: number | null;
  reason?: string | null;
  title?: string | null;
};

type TelegramTodayData = {
  plan?: TelegramPlan | null;
  blocks?: TelegramBlock[] | null;
  unscheduled?: TelegramUnscheduledTask[] | null;
};

function clean(value: unknown) {
  const v = String(value ?? "").trim();
  return v || null;
}

function formatTime(value: unknown) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

function formatToday(data: TelegramTodayData | null | undefined) {
  const lines: string[] = [];
  lines.push("📅 Today's Plan");
  lines.push("");

  const plan = data?.plan;
  if (!plan) {
    lines.push("No plan found for today.");
    lines.push("Open the app to create or confirm today's plan.");
    return lines.join("\n");
  }

  lines.push(`Status: ${plan.status ?? "unknown"} • Version ${plan.version ?? "?"}`);
  if (plan.buffer_minutes != null) lines.push(`Buffer: ${plan.buffer_minutes} min`);
  lines.push("");

  const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
  const scheduled = blocks.filter((b) => b.kind !== "buffer");

  if (scheduled.length) {
    lines.push("⏰ Schedule");
    for (const b of scheduled) {
      const start = formatTime(b.start_time);
      const end = formatTime(b.end_time);
      lines.push(`• ${start}-${end} — ${b.title ?? "Untitled task"}`);
    }
    lines.push("");
  }

  const unscheduled = Array.isArray(data?.unscheduled) ? data.unscheduled : [];
  if (unscheduled.length) {
    lines.push("📌 Unscheduled");
    for (const t of unscheduled) {
      const mins = t.estimated_minutes ? ` (${t.estimated_minutes}m)` : "";
      const reason = t.reason ? ` — ${t.reason}` : "";
      lines.push(`• ${t.title ?? "Untitled task"}${mins}${reason}`);
    }
    lines.push("");
  }

  if (!scheduled.length && !unscheduled.length) {
    lines.push("No scheduled or unscheduled tasks found.");
  }

  return lines.join("\n").slice(0, 3900);
}

export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_CHECKIN_WEBHOOK_SECRET;
  const suppliedSecret = request.headers.get("x-telegram-checkin-secret");

  if (!secret || suppliedSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const chatId = clean(body.chat_id);
  const command = (clean(body.command) || clean(body.text) || "").toLowerCase().split(/\s+/)[0];

  if (!chatId) {
    return NextResponse.json({ error: "chat_id is required" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return NextResponse.json({ error: "Supabase configuration is incomplete" }, { status: 500 });
  }

  const timeZone = clean(body.time_zone) || DEFAULT_TIMEZONE;
  const planDate = clean(body.plan_date) || getTodayISODate(timeZone);

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (command === "/today" || command === "today" || command === "/plan" || command === "plan") {
    const { data, error } = await supabase.rpc("telegram_today", {
      p_chat_id: chatId,
      p_plan_date: planDate,
    });

    if (error) {
      const status = error.message === "Telegram chat is not linked" ? 403 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    const todayData = data as TelegramTodayData | null;

    return NextResponse.json({
      ok: true,
      command: command.replace(/^\//, ""),
      chat_id: chatId,
      plan_date: planDate,
      text: formatToday(todayData),
      data,
    });
  }

  if (command === "/help" || command === "help" || command === "/start" || command === "start") {
    return NextResponse.json({
      ok: true,
      command: "help",
      chat_id: chatId,
      text: "🤖 Productivity Assistant\n\n/today — show today's plan\n/plan — show today's plan\n/checkin — submit your daily check-in\n/help — show this help",
    });
  }

  return NextResponse.json({
    ok: true,
    command: "unknown",
    chat_id: chatId,
    text: "I don't know that command yet. Try /today, /checkin, or /help.",
  });
}
