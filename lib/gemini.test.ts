import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GEMINI_MODELS, generateGeminiJson } from "@/lib/gemini";

const schema = { type: "object" };

function answer(text: string, finishReason = "STOP") {
  return new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }), { status: 200 });
}

function modelOf(call: unknown[]) {
  return String(call[0]).match(/models\/([^:]+):/)?.[1];
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("generateGeminiJson", () => {
  it("asks the fast model first, with a time limit and an output cap", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(answer('{"ok":true}'));
    expect(await generateGeminiJson({ prompt: "p", responseSchema: schema })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(modelOf(fetchMock.mock.calls[0])).toBe(GEMINI_MODELS[0].name);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body)).generationConfig).toMatchObject({ maxOutputTokens: 4096, responseSchema: schema });
  });

  it("moves straight to the next model on high demand or a timeout, without retrying the same one", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }))
      .mockResolvedValueOnce(answer('{"ok":3}'));
    expect(await generateGeminiJson({ prompt: "p", responseSchema: schema })).toEqual({ ok: 3 });
    expect(fetchMock.mock.calls.map(modelOf)).toEqual(GEMINI_MODELS.map((model) => model.name));
  });

  it("treats an answer cut off at the output limit as a failure and tries the next model", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer('{"items":[', "MAX_TOKENS"))
      .mockResolvedValueOnce(answer('{"ok":2}'));
    expect(await generateGeminiJson({ prompt: "p", responseSchema: schema })).toEqual({ ok: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops at an authentication error and reports its status", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad key", { status: 403 }));
    await expect(generateGeminiJson({ prompt: "p", responseSchema: schema })).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports the last status when every model fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("busy", { status: 503 }));
    await expect(generateGeminiJson({ prompt: "p", responseSchema: schema })).rejects.toMatchObject({ status: 503 });
  });

  it("fails before any request when the key is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    vi.resetModules();
    const fresh = await import("@/lib/gemini");
    await expect(fresh.generateGeminiJson({ prompt: "p", responseSchema: schema })).rejects.toThrow("Missing GEMINI_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
