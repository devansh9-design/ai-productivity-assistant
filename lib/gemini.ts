import "server-only";

// Prefer the newest stable Flash model, but keep lower-cost/older stable
// models available as capacity fallbacks. Gemini can return 503 during
// temporary capacity spikes even when the API key and request are valid.
const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

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

function shouldTryAnotherModel(status: number): boolean {
  // 404 can happen when a model is unavailable to a particular API project.
  // 429/5xx are transient capacity/quota/server conditions.
  return (
    status === 404 ||
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function requestModel(
  model: string,
  prompt: string,
  responseSchema: Record<string, unknown>,
): Promise<Response> {
  const isGemini38 = model === "gemini-3.8-flash";

  // Retry a transient failure once before moving to the next model.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const generationConfig: Record<string, unknown> = {
      responseMimeType: "application/json",
      responseSchema,
    };

    // Gemini 3.8 uses thinkingLevel instead of the legacy temperature
    // sampling control. Other stable Flash fallbacks can use temperature.
    if (!isGemini38) {
      generationConfig.temperature = 0.2;
    } else {
      generationConfig.thinkingConfig = { thinkingLevel: "low" };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": getGeminiApiKey(),
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      }),
      cache: "no-store",
    });

    if (response.ok) return response;

    if (!shouldTryAnotherModel(response.status) || attempt === 1) {
      return response;
    }

    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
  }

  throw new Error("Gemini request failed unexpectedly.");
}

export async function generateGeminiJson({
  prompt,
  responseSchema,
}: GeminiGenerateOptions): Promise<unknown> {
  let lastStatus = 503;
  let lastBody = "";

  for (const model of GEMINI_MODELS) {
    const response = await requestModel(model, prompt, responseSchema);

    if (response.ok) {
      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };

      const text = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim();

      if (!text) {
        throw new Error("Gemini returned an empty response.");
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new Error("Gemini returned invalid JSON.");
      }
    }

    lastStatus = response.status;
    lastBody = await response.text().catch(() => "");

    if (!shouldTryAnotherModel(response.status)) break;
  }

  const error = new Error(`Gemini API request failed with status ${lastStatus}.`);
  Object.assign(error, { status: lastStatus, body: lastBody });
  throw error;
}
