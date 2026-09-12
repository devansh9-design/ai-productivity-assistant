import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isValidISODate } from "@/lib/tasks/date-validation";
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

const TASK_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const rawCommand = clean(body.command) || clean(body.text) || "";
  const parts = rawCommand.trim().split(/\s+/);
  const command = (parts[0] || "").toLowerCase();

  const chatId = clean(body.chat_id);

  if (!chatId) {
    return NextResponse.json({ error: "chat_id is required" }, { status: 400 });
  }

  const timeZone = clean(body.time_zone) || DEFAULT_TIMEZONE;
  const planDate = clean(body.plan_date) || getTodayISODate(timeZone);

  if (!isValidISODate(planDate)) {
    return NextResponse.json({ error: "plan_date must use YYYY-MM-DD format." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

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

  if (command === "/done" || command === "done" || command === "/skip" || command === "skip") {
    const taskId = parts[1] || "";
    const isSkip = command === "/skip" || command === "skip";

    if (!TASK_ID_REGEX.test(taskId)) {
      return NextResponse.json(
        {
          error: isSkip
            ? "Usage: /skip <task-id> <reason>"
            : "Usage: /done <task-id>",
        },
        { status: 400 },
      );
    }

    const mapping = await supabase
      .from("telegram_chat_mappings")
      .select("user_id")
      .eq("chat_id", chatId)
      .maybeSingle();

    if (mapping.error) {
      return NextResponse.json({ error: mapping.error.message }, { status: 500 });
    }

    if (!mapping.data) {
      return NextResponse.json(
        { error: "Telegram chat is not linked to an account." },
        { status: 403 },
      );
    }

    const reason = parts.slice(2).join(" ").trim();

    const { data: task, error: lookupError } = await supabase
      .from("tasks")
      .select("id,title,status")
      .eq("id", taskId)
      .eq("user_id", mapping.data.user_id)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 500 });
    }

    if (!task) {
      return NextResponse.json(
        { error: "Task not found for this Telegram account. Check the task ID and try again." },
        { status: 404 },
      );
    }

    // Validate the skip reason only when the task actually needs to be skipped.
    // This also lets a repeated /skip remain idempotent even if Telegram/n8n
    // drops the reason on a retry.
    if (isSkip && task.status !== "skipped" && !reason) {
      return NextResponse.json(
        { error: "Usage: /skip <task-id> <reason>" },
        { status: 400 },
      );
    }

    // Idempotency: repeated /done on an already completed task must not
    // issue another database update.
    if (!isSkip && task.status === "completed") {
      return NextResponse.json({
        ok: true,
        command: "done",
        chat_id: chatId,
        task_id: task.id,
        already_completed: true,
        text: `ℹ️ Already completed: ${task.title}`,
      });
    }

    // Idempotency: repeated /skip on an already skipped task must not
    // issue another database update, even if a retry has no reason.
    if (isSkip && task.status === "skipped") {
      return NextResponse.json({
        ok: true,
        command: "skip",
        chat_id: chatId,
        task_id: task.id,
        already_skipped: true,
        text: `ℹ️ Already skipped: ${task.title}${task.status ? "" : ""}`,
      });
    }

    const update = isSkip
      ? { status: "skipped", status_reason: reason }
      : { status: "completed", status_reason: null };

    const { error: updateError } = await supabase
      .from("tasks")
      .update(update)
      .eq("id", task.id)
      .eq("user_id", mapping.data.user_id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      command: isSkip ? "skip" : "done",
      chat_id: chatId,
      task_id: task.id,
      text: isSkip
        ? `⏭️ Skipped: ${task.title}\nReason: ${reason}`
        : `✅ Completed: ${task.title}`,
    });
  }

  if (command === "/help" || command === "help" || command === "/start" || command === "start") {
    return NextResponse.json({
      ok: true,
      command: "help",
      chat_id: chatId,
      text: "🤖 Productivity Assistant\n\n/today — show today's plan\n/plan — show today's plan\n/checkin — submit your daily check-in\n/done <task-id> — mark your task completed\n/skip <task-id> <reason> — skip a task with a reason\n/help — show this help",
    });
  }

  return NextResponse.json({
    ok: true,
    command: "unknown",
    chat_id: chatId,
    text: "I don't know that command yet. Try /today, /done, /skip, /checkin, or /help.",
  });
}
