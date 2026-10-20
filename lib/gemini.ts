import "server-only";

import { log } from "@/lib/log";

/**
 * Tried in order until one answers. Measured on 2026-10-20 with the planning
 * prompt (about 900 tokens): 3.5 Flash-Lite answered in 2-4s with valid plans
 * once every schema field was required; 3.5 and 3.6 Flash took 4-14s and
 * sometimes returned 503 ("high demand"). 3.8 and 3.7 Flash took 80-106s, and
 * 3.1 Flash-Lite kept generating until it hit the output limit, so they are
 * not used.
 */
export const GEMINI_MODELS = [
  { name: "gemini-3.5-flash-lite", config: { temperature: 0.2 } },
  { name: "gemini-3.5-flash", config: { thinkingConfig: { thinkingLevel: "low" } } },
  { name: "gemini-3.6-flash", config: { thinkingConfig: { thinkingLevel: "low" } } },
] as const;

/** A model that has not answered by then is abandoned for the next one. */
export const MODEL_TIMEOUT_MS = 20_000;
/** Bounds a runaway answer; real proposals and summaries use well under 1,000 tokens. */
const MAX_OUTPUT_TOKENS = 4096;

let apiKey: string | undefined;

function getGeminiApiKey(): string {
  if (apiKey) return apiKey;

  const value = process.env.GEMINI_API_KEY;
  if (!value) {
    throw new Error("Missing GEMINI_API_KEY environment variable.");
  }

  apiKey = value;
  return value;
}

export type GeminiGenerateOptions = {
  prompt: string;
  responseSchema: Record<string, unknown>;
};

/** Worth trying the next model: unavailable to this project (404), timed out, rate-limited or a server error. */
function shouldTryAnotherModel(status: number): boolean {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

/** One request to one model; a timeout or network failure is reported as status 408 or 503. */
async function requestModel(
  model: (typeof GEMINI_MODELS)[number],
  prompt: string,
  responseSchema: Record<string, unknown>,
): Promise<{ status: number; text?: string; body?: string }> {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.name}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": getGeminiApiKey(),
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          ...model.config,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    if (!response.ok) return { status: response.status, body: await response.text().catch(() => "") };

    const data = (await response.json()) as {
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
    };
    const candidate = data.candidates?.[0];
    // A cut-off answer is invalid JSON; treat it like an error so the next model is tried.
    if (candidate?.finishReason === "MAX_TOKENS") return { status: 502, body: "Answer exceeded the output limit." };
    return { status: 200, text: candidate?.content?.parts?.map((part) => part.text ?? "").join("").trim() };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { status: timedOut ? 408 : 503, body: error instanceof Error ? error.message : "Request failed." };
  }
}

export async function generateGeminiJson({
  prompt,
  responseSchema,
}: GeminiGenerateOptions): Promise<unknown> {
  getGeminiApiKey();
  let lastStatus = 503;
  let lastBody = "";
  const started = Date.now();
  const failedModels: Array<{ model: string; status: number; ms: number }> = [];

  for (const model of GEMINI_MODELS) {
    const modelStarted = Date.now();
    const result = await requestModel(model, prompt, responseSchema);

    if (result.status === 200) {
      // Which model answered and how long it took, including any fallbacks before it.
      log("info", "ai.gemini_answered", { model: model.name, ms: Date.now() - started, modelMs: Date.now() - modelStarted, failedModels });

      if (!result.text) {
        throw new Error("Gemini returned an empty response.");
      }

      try {
        return JSON.parse(result.text);
      } catch {
        throw new Error("Gemini returned invalid JSON.");
      }
    }

    lastStatus = result.status;
    lastBody = result.body ?? "";
    failedModels.push({ model: model.name, status: result.status, ms: Date.now() - modelStarted });

    if (!shouldTryAnotherModel(result.status)) break;
  }

  log("error", "ai.gemini_failed", { ms: Date.now() - started, failedModels });
  const error = new Error(`Gemini API request failed with status ${lastStatus}.`);
  Object.assign(error, { status: lastStatus, body: lastBody });
  throw error;
}
