import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { errorFields, log } from "@/lib/log";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("ai_conversations")
      .select("id, message, proposal, proposal_type, validation_ok, confirmed, confirmed_plan_id, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      log("error", "ai.history_failed", errorFields(error));
      return NextResponse.json({ error: "Unable to load AI history." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, conversations: data ?? [] });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    log("error", "ai.history_failed", errorFields(error));
    return NextResponse.json({ error: "Unable to load AI history." }, { status: 500 });
  }
}
