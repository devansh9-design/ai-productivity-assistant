import { describe, expect, it } from "vitest";
import { TelegramCheckinValidationError, parseTelegramCheckinPayload } from "./checkin";

const payload = {
  chat_id: 8206591526,
  mood: 4,
  energy_level: "medium",
  wins: "Finished Day 7 work",
  distractions: "Phone",
  lesson: "Focus on one task at a time",
  reflection: "Productive day overall",
  time_zone: "Asia/Kolkata",
};

describe("parseTelegramCheckinPayload", () => {
  it.each([1, 5, "1", "5"])("accepts mood %s", (mood) => {
    expect(parseTelegramCheckinPayload({ ...payload, mood }).mood).toBe(Number(mood));
  });

  it.each([0, 6, "abc", "=4"])("rejects invalid mood %s", (mood) => {
    expect(() => parseTelegramCheckinPayload({ ...payload, mood })).toThrow(
      TelegramCheckinValidationError,
    );
  });

  it("allows mood to be omitted", () => {
    expect(parseTelegramCheckinPayload({ ...payload, mood: undefined }).mood).toBeNull();
  });

  it("preserves a valid Telegram chat ID", () => {
    expect(parseTelegramCheckinPayload(payload).chatId).toBe("8206591526");
  });

  it("rejects expression-prefixed chat IDs", () => {
    expect(() => parseTelegramCheckinPayload({ ...payload, chat_id: "=8206591526" })).toThrow(
      "chat_id must be a Telegram chat ID.",
    );
  });
});
