import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

type ChatRequest = {
  message?: string;
};

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

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "You are a safe productivity planning assistant. Do not perform database, calendar, task, or other external writes. For now, provide planning guidance only.",
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    return NextResponse.json({
      ok: true,
      text: response.output_text,
    });
  } catch (error) {
    console.error("AI chat error:", error);

    return NextResponse.json(
      { error: "Unable to process AI request." },
      { status: 500 },
    );
  }
}
