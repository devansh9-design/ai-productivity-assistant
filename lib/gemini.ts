import "server-only";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

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

export async function generateGeminiJson({
  prompt,
  responseSchema,
}: GeminiGenerateOptions): Promise<unknown> {
  const response = await fetch(
    GEMINI_API_URL,
    {
      method: "POST",
      headers: {\n        "Content-Type": "application/json",\n        "x-goog-api-key": getGeminiApiKey(),\n      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
          temperature: 0.2,
        },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(
      `Gemini API request failed with status ${response.status}.`,
    );
    Object.assign(error, { status: response.status, body });
    throw error;
  }

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
