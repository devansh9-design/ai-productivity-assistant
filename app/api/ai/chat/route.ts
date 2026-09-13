import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/openai";
import {
  PROPOSAL_TYPES,
  type PlanningProposal,
} from "@/lib/ai/proposal";
import { validatePlanningProposal } from "@/lib/ai/validate-proposal";

export const runtime = "nodejs";

type ChatRequest = {
  message?: string;
};

const proposalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: {
      type: "string",
      enum: [...PROPOSAL_TYPES],
    },
    summary: { type: "string" },
    reason: { type: "string" },
    items: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          task_id: { type: "string" },
          title: { type: "string" },
          reason: { type: "string" },
          start_time: { type: "string" },
          end_time: { type: "string" },
          estimated_minutes: { type: "integer" },
        },
        required: ["reason"],
      },
    },
  },
  required: ["type", "summary", "reason", "items"],
} as const;

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequest;
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 },
      );
    }

    if (message.length > 4000) {
      return NextResponse.json(
        { error: "message is too long" },
        { status: 400 },
      );
    }

    const response = await getOpenAIClient().responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [
            "You are a safe productivity planning assistant.",
            "Return ONLY one JSON object matching the supplied schema.",
            "Do not perform or claim to perform database, calendar, or task writes.",
            "Never propose modifying a completed task.",
            "Never intentionally create overlapping schedule items.",
            "Every proposal item must include a concise reason.",
          ].join(" "),
        },
        {
          role: "user",
          content: message,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "planning_proposal",
          strict: true,
          schema: proposalSchema,
        },
      },
    });

    const proposal = extractJson(response.output_text);
    const validation = validatePlanningProposal(proposal);

    if (!validation.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "AI returned an invalid planning proposal.",
          details: validation.error,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      proposal: validation.data as PlanningProposal,
      requires_confirmation: true,
    });
  } catch (error) {
    console.error("AI chat error:", error);

    return NextResponse.json(
      { error: "Unable to process AI request." },
      { status: 500 },
    );
  }
}
