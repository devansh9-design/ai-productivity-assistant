import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/require-user";
import { TIMEZONE_COOKIE_NAME, DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";
import { getValidAccessToken } from "@/lib/google/oauth";
import { fetchCalendarEvents } from "@/lib/google/calendar";
import { buildAiContext, AI_INSTRUCTIONS, aiProposalSchema, validateAiProposal } from "@/lib/ai/assistant";
import { generateDraftPlan } from "@/lib/plans/actions";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const MAX_MESSAGE_LENGTH = 2000;

function extractOutputText(body: unknown): string {
  const response = body as { output_text?: unknown; output?: unknown[] };
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output ?? []) {
    if (!item || typeof item !== "object") continue;
    const contents = (item as { content?: unknown[] }).content ?? [];
    for (const content of contents) {
      if (content && typeof content === "object" && typeof (content as { text?: unknown }).text === "string") {
        return (content as { text: string }).text;
      }
    }
  }
  throw new Error("OpenAI returned no structured output.");
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message || message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: "Enter a message up to 2000 characters." }, { status: 400 });
    }

    const cookieStore = await cookies();
    const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
    const date = getTodayISODate(timeZone);

    const [
      { data: tasks },
      { data: plans },
      { data: blocks },
      { data: commitments },
      { data: goals },
      { data: projects },
      { data: milestones },
      { data: checkins },
      { data: journals },
    ] = await Promise.all([
      supabase.from("tasks").select("*").order("due_date", { ascending: true }).limit(100),
      supabase.from("daily_plans").select("*").eq("plan_date", date).order("version", { ascending: false }).limit(3),
      supabase.from("plan_blocks").select("*").eq("user_id", user.id).limit(100),
      supabase.from("fixed_commitments").select("*").eq("commitment_date", date).order("start_time"),
      supabase.from("goals").select("*").eq("status", "active").limit(20),
      supabase.from("projects").select("*").eq("status", "active").limit(20),
      supabase.from("milestones").select("*").eq("status", "active").limit(20),
      supabase.from("checkins").select("*").eq("type", "evening").order("checkin_date", { ascending: false }).limit(7),
      supabase.from("journal_entries").select("*").order("entry_date", { ascending: false }).limit(7),
    ]);

    let calendarEvents: Array<{ googleEventId: string; title: string; startTime: string; endTime: string }> = [];
    const tokenResult = await getValidAccessToken(user.id);
    if (!("error" in tokenResult)) {
      try { calendarEvents = await fetchCalendarEvents(tokenResult.token, date, timeZone); } catch { /* AI can still answer from app context. */ }
    }

    const context = buildAiContext({
      date, timeZone, message,
      tasks: tasks ?? [], plans: plans ?? [], blocks: blocks ?? [], commitments: commitments ?? [],
      goals: goals ?? [], projects: projects ?? [], milestones: milestones ?? [],
      checkins: checkins ?? [], journals: journals ?? [], calendarEvents,
    });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured on the server." }, { status: 503 });

    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        instructions: AI_INSTRUCTIONS,
        input: JSON.stringify(context),
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "productivity_proposal",
            strict: true,
            schema: aiProposalSchema(),
          },
        },
      }),
    });

    const responseBody = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: responseBody?.error?.message || "OpenAI request failed." }, { status: 502 });
    }

    const proposal = validateAiProposal(JSON.parse(extractOutputText(responseBody)));
    const { data: userMessage, error: messageError } = await supabase
      .from("ai_assistant_messages")
      .insert({ user_id: user.id, role: "user", content: message })
      .select("id")
      .single();

    if (messageError) throw new Error(messageError.message);

    const assistantContent = proposal.summary + (proposal.rationale ? `\n\n${proposal.rationale}` : "");
    const { data: assistantMessage, error: assistantError } = await supabase
      .from("ai_assistant_messages")
      .insert({ user_id: user.id, role: "assistant", content: assistantContent })
      .select("id")
      .single();
    if (assistantError) throw new Error(assistantError.message);

    const { data: savedProposal, error: proposalError } = await supabase
      .from("ai_assistant_proposals")
      .insert({
        user_id: user.id,
        message_id: assistantMessage.id,
        proposal_type: proposal.proposal_type,
        proposal,
      })
      .select("id")
      .single();
    if (proposalError) throw new Error(proposalError.message);

    return NextResponse.json({ proposal_id: savedProposal.id, proposal, user_message_id: userMessage.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assistant request failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const proposalId = typeof body?.proposal_id === "string" ? body.proposal_id : "";
    if (!proposalId) return NextResponse.json({ error: "Proposal ID is required." }, { status: 400 });

    const { data: proposalRow, error } = await supabase
      .from("ai_assistant_proposals")
      .select("id,proposal_type,proposal,status")
      .eq("id", proposalId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !proposalRow) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    if (proposalRow.status !== "pending") return NextResponse.json({ error: "Proposal has already been resolved." }, { status: 409 });

    const proposal = validateAiProposal(proposalRow.proposal);
    if (proposal.proposal_type === "suggest_schedule") {
      const result = await generateDraftPlan();
      if (result?.error) return NextResponse.json({ error: result.error }, { status: 400 });
    } else if (proposal.proposal_type === "propose_task_draft") {
      const action = proposal.actions.find((item) => item.type === "draft_task");
      if (!action?.title) return NextResponse.json({ error: "The proposal contains no valid task draft." }, { status: 400 });
      const allowedPriority = new Set(["low","medium","high","urgent"]);
      const priority = action.priority && allowedPriority.has(action.priority) ? action.priority : "medium";
      const { error: insertError } = await supabase.from("tasks").insert({
        user_id: user.id,
        title: action.title.slice(0, 200),
        description: action.description?.slice(0, 5000) || null,
        priority,
        estimated_minutes: action.estimated_minutes && action.estimated_minutes > 0 ? Math.min(action.estimated_minutes, 1440) : null,
        due_date: action.due_date || null,
        status: "todo",
      });
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    const { error: updateError } = await supabase
      .from("ai_assistant_proposals")
      .update({ status: "accepted", resolved_at: new Date().toISOString() })
      .eq("id", proposalId)
      .eq("user_id", user.id);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ ok: true, proposal_type: proposal.proposal_type });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not confirm proposal." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const proposalId = typeof body?.proposal_id === "string" ? body.proposal_id : "";
    if (!proposalId) return NextResponse.json({ error: "Proposal ID is required." }, { status: 400 });
    const { error } = await supabase
      .from("ai_assistant_proposals")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", proposalId)
      .eq("user_id", user.id)
      .eq("status", "pending");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not reject proposal." }, { status: 500 });
  }
}
