import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type Update = {
  message?: {
    text?: string;
    chat?: { id?: number | string };
  };
};

const clean = (value: unknown) => {
  const result = String(value ?? "").trim();
  return result || null;
};

const telegramReply = (chatId: string, text: string) =>
  NextResponse.json({ method: "sendMessage", chat_id: chatId, text });

export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_CHECKIN_WEBHOOK_SECRET;
  const supplied = request.headers.get("x-telegram-bot-api-secret-token");
  if (!secret || supplied !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let update: Update;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid Telegram update" }, { status: 400 });
  }

  const chatId = clean(update.message?.chat?.id);
  const incoming = clean(update.message?.text);
  if (!chatId || !incoming) return new NextResponse(null, { status: 200 });

  const match = incoming.match(/^\/(today|plan|done|skip|help|start)(?:@\w+)?(?:\s+([\s\S]+))?$/i);
  if (!match) return telegramReply(chatId, "Try /today, /done <task name>, /skip <task name> <reason>, or /help.");

  const command = match[1].toLowerCase();
  const args = (match[2] ?? "").trim();
  const supabase = createServiceRoleClient();

  const mapping = await supabase
    .from("telegram_chat_mappings")
    .select("user_id")
    .eq("chat_id", chatId)
    .maybeSingle();

  if (mapping.error) return NextResponse.json({ error: mapping.error.message }, { status: 500 });
  if (!mapping.data) return telegramReply(chatId, "This Telegram chat is not linked to your Productivity Assistant account.");

  if (command === "help" || command === "start") {
    return telegramReply(chatId, "🤖 Productivity Assistant\n\n/today — show today's plan\n/done <task name> — complete a task\n/skip <task name> <reason> — skip a task\n/help — show this help");
  }

  if (command === "today" || command === "plan") {
    const planDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Calcutta" }).format(new Date());
    const { data, error } = await supabase.rpc("telegram_today", {
      p_chat_id: chatId,
      p_plan_date: planDate,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
    const lines = blocks
      .filter((block: { kind?: string }) => block.kind !== "buffer")
      .map((block: { start_time?: string; end_time?: string; title?: string; status?: string }) => {
        const icon = block.status === "completed" ? "✅" : block.status === "skipped" ? "⏭️" : "⬜";
        return `${icon} ${String(block.start_time ?? "").slice(0, 5)}-${String(block.end_time ?? "").slice(0, 5)} — ${block.title ?? "Task"}`;
      });

    return telegramReply(chatId, `📅 Today's Plan\n\n${lines.join("\n") || "No scheduled tasks."}`);
  }

  if (command === "done" || command === "skip") {
    if (!args) return telegramReply(chatId, command === "done" ? "Usage: /done <task name>" : "Usage: /skip <task name> <reason>");

    let requestedTitle = args;
    let reason = "";
    const separator = args.indexOf("|");
    if (separator >= 0) {
      requestedTitle = args.slice(0, separator).trim();
      reason = args.slice(separator + 1).trim();
    }

    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("id,title,status")
      .eq("user_id", mapping.data.user_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let matches = (tasks ?? []).filter(
      (task) => String(task.title ?? "").trim().toLowerCase() === requestedTitle.toLowerCase(),
    );

    if (command === "skip" && !reason && matches.length === 0) {
      matches = (tasks ?? [])
        .filter((task) => args.toLowerCase().startsWith(String(task.title ?? "").trim().toLowerCase() + " "))
        .sort((a, b) => String(b.title ?? "").length - String(a.title ?? "").length);
      if (matches.length) {
        requestedTitle = String(matches[0].title ?? "");
        reason = args.slice(requestedTitle.length).trim();
      }
    }

    if (!matches.length) return telegramReply(chatId, `Task "${requestedTitle}" not found. Use /today to see task names.`);
    if (matches.length > 1) return telegramReply(chatId, `Multiple tasks match "${requestedTitle}". Please use a more specific task name.`);
    if (command === "skip" && !reason) return telegramReply(chatId, "A reason is required. Use /skip <task name> <reason>.");

    const task = matches[0];
    const update = command === "skip"
      ? { status: "skipped", status_reason: reason }
      : { status: "completed", status_reason: null };

    const { error: updateError } = await supabase
      .from("tasks")
      .update(update)
      .eq("id", task.id)
      .eq("user_id", mapping.data.user_id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return telegramReply(
      chatId,
      command === "skip" ? `⏭️ Skipped: ${task.title}\nReason: ${reason}` : `✅ Completed: ${task.title}`,
    );
  }

  return new NextResponse(null, { status: 200 });
}
