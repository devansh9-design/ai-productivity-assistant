import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";

export const runtime = "nodejs";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

async function sendTelegramMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram API failed with ${response.status}: ${body}`);
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const { data: mappings, error } = await supabase
    .from("telegram_chat_mappings")
    .select("chat_id, user_id")
    .not("chat_id", "is", null);

  if (error) {
    console.error("Telegram cron mapping lookup failed", error);
    return NextResponse.json({ error: "Unable to load Telegram mappings." }, { status: 500 });
  }

  const planDate = getTodayISODate(DEFAULT_TIMEZONE);
  let sent = 0;
  const failures: Array<{ chat_id: string; error: string }> = [];

  for (const mapping of mappings ?? []) {
    try {
      const { data, error: rpcError } = await supabase.rpc("telegram_today", {
        p_chat_id: mapping.chat_id,
        p_plan_date: planDate,
      });

      if (rpcError) throw rpcError;
      if (!data?.plan) continue;

      const blocks = Array.isArray(data.blocks) ? data.blocks : [];
      const lines = blocks.map((block: { start_time?: string; end_time?: string; title?: string; status?: string }) => {
        const icon = block.status === "completed" ? "✅" : block.status === "skipped" ? "⏭️" : "⬜";
        return `${icon} ${block.start_time ?? ""} - ${block.end_time ?? ""} — ${block.title ?? "Task"}`;
      });

      const message = `Today's plan\n\n${lines.join("\n") || "No scheduled tasks."}`;
      await sendTelegramMessage(mapping.chat_id, message);
      sent += 1;
    } catch (err) {
      failures.push({ chat_id: mapping.chat_id, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return NextResponse.json({ ok: failures.length === 0, sent, failed: failures.length, failures });
}
