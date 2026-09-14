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
    const isSkip = command === "/skip" || command === "skip";

    // Accept task names from Telegram text, n8n command fields, or dedicated fields.
    const extractArgs = (value: unknown) => {
      const text = clean(value) || "";
      const match = text.match(/^\/?(?:done|skip)(?:\s+(.+))?$/i);
      return match?.[1]?.trim() || "";
    };

    const commandArgs =
      clean(body.task_name) ||
      clean(body.task_title) ||
      extractArgs(body.text) ||
      extractArgs(body.command) ||
      clean(body.args) ||
      "";

    const mapping = await supabase
      .from("telegram_chat_mappings")
      .select("user_id")
      .eq("chat_id", chatId)
      .maybeSingle();

    if (mapping.error) return NextResponse.json({ error: mapping.error.message }, { status: 500 });
    if (!mapping.data) return NextResponse.json({ error: "Telegram chat is not linked to an account." }, { status: 403 });

    if (!commandArgs) {
      return NextResponse.json({
        error: isSkip
          ? "Usage: /skip <task name> [reason]"
          : "Usage: /done <task name>",
      }, { status: 400 });
    }

    const { data: tasks, error: tasksError } = await supabase
      .from("tasks")
      .select("id,title,status")
      .eq("user_id", mapping.data.user_id);

    if (tasksError) return NextResponse.json({ error: tasksError.message }, { status: 500 });

    const taskList = Array.isArray(tasks) ? tasks : [];
    const normalized = commandArgs.toLowerCase();

    // For /skip, a "|" makes the boundary between task name and reason explicit:
    // /skip Task name | reason
    let requestedTitle = commandArgs;
    let reason = "";
    const separatorIndex = commandArgs.indexOf("|");
    if (separatorIndex >= 0) {
      requestedTitle = commandArgs.slice(0, separatorIndex).trim();
      reason = commandArgs.slice(separatorIndex + 1).trim();
    }

    let matches = taskList.filter(
      (task) => String(task.title ?? "").trim().toLowerCase() === requestedTitle.toLowerCase(),
    );

    // Also support /skip Task name reason without requiring "|": find a task title
    // that is the longest case-insensitive prefix of the supplied arguments.
    if (isSkip && separatorIndex < 0 && matches.length === 0) {
      matches = taskList
        .filter((task) => {
          const title = String(task.title ?? "").trim().toLowerCase();
          return title && normalized.startsWith(title + " ");
        })
        .sort((a, b) => String(b.title ?? "").length - String(a.title ?? "").length);

      if (matches.length) {
        const matchedTitle = String(matches[0].title ?? "").trim();
        reason = commandArgs.slice(matchedTitle.length).trim();
      }
    }

    if (!matches.length) {
      return NextResponse.json({
        error: `Task "${requestedTitle}" not found for this Telegram account. Use /today to see task names.`,
      }, { status: 404 });
    }

    if (matches.length > 1) {
      return NextResponse.json({
        error: `Multiple tasks match "${requestedTitle}". Please use a more specific task name.`,
      }, { status: 409 });
    }

    const task = matches[0];

    if (isSkip && !reason) {
      return NextResponse.json({
        error: "A reason is required. Usage: /skip <task name> <reason> (or /skip <task name> | <reason>)",
      }, { status: 400 });
    }

    const update = isSkip
      ? { status: "skipped", status_reason: reason }
      : { status: "completed", status_reason: null };

    const { error: updateError } = await supabase
      .from("tasks")
      .update(update)
      .eq("id", task.id)
      .eq("user_id", mapping.data.user_id);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      command: isSkip ? "skip" : "done",
      chat_id: chatId,
      task_id: task.id,
      task_title: task.title,
      text: isSkip ? `⏭️ Skipped: ${task.title}\nReason: ${reason}` : `✅ Completed: ${task.title}`,
    });
  }

  if (command === "/help" || command === "help" || command === "/start" || command === "start") {
    return NextResponse.json({
      ok: true,
      command: "help",
      chat_id: chatId,
      text: "🤖 Productivity Assistant\n\n/today — show today's plan\n/plan — show today's plan\n/checkin — submit your daily check-in\n/done <task name> — mark your task completed\n/skip <task name> <reason> — skip a task with a reason\n/help — show this help",
    });
  }

  return NextResponse.json({
    ok: true,
    command: "unknown",
    chat_id: chatId,
    text: "I don't know that command yet. Try /today, /done, /skip, /checkin, or /help.",
  });
}
