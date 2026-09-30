import "server-only";

const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
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

function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function requestModel(
  model: string,
  prompt: string,
  responseSchema: Record<string, unknown>,
): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, {
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
          temperature: 0.2,
        },
      }),
      cache: "no-store",
    });

    if (response.ok) return response;

    if (!isRetryable(response.status) || attempt === 1) return response;

    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
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

    // Try the next stable Flash model for temporary capacity/rate-limit errors.
    if (!isRetryable(response.status)) break;
  }

  const error = new Error(
    `Gemini API request failed with status ${lastStatus}.`,
  );
  Object.assign(error, { status: lastStatus, body: lastBody });
  throw error;
}
