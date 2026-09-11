import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient }));

import { POST } from "./route";

const validPayload = {
  chat_id: 8206591526,
  mood: 4,
  energy_level: "medium",
  wins: "Finished Day 7 work",
  distractions: "Phone",
  lesson: "Focus on one task at a time",
  reflection: "Productive day overall",
  time_zone: "Asia/Kolkata",
};

function request(body: BodyInit, secret = "test-secret") {
  return new Request("http://localhost/api/telegram/checkin", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-checkin-secret": secret },
    body,
  });
}

function configureSupabase(mapping: { user_id: string } | null = { user_id: "user-1" }) {
  const mappingQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: mapping, error: null }),
  };
  const checkinQuery = {
    upsert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: "checkin-1" }, error: null }),
  };
  const journalQuery = { upsert: vi.fn().mockResolvedValue({ error: null }) };
  createServiceRoleClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "telegram_chat_mappings") return mappingQuery;
      if (table === "checkins") return checkinQuery;
      return journalQuery;
    }),
  });
  return { mappingQuery, checkinQuery, journalQuery };
}

describe("POST /api/telegram/checkin", () => {
  beforeEach(() => {
    process.env.TELEGRAM_CHECKIN_WEBHOOK_SECRET = "test-secret";
    createServiceRoleClient.mockReset();
  });

  it("rejects an invalid secret before accessing Supabase", async () => {
    const response = await POST(request(JSON.stringify(validPayload), "wrong-secret"));

    expect(response.status).toBe(401);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(request("not-json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Request body must be valid JSON." });
  });

  it("returns 404 for an unlinked chat without writing a check-in", async () => {
    const { checkinQuery } = configureSupabase(null);
    const response = await POST(request(JSON.stringify(validPayload)));

    expect(response.status).toBe(404);
    expect(checkinQuery.upsert).not.toHaveBeenCalled();
  });

  it("uses the mapped user and unique constraints for repeat-safe writes", async () => {
    const { mappingQuery, checkinQuery, journalQuery } = configureSupabase();
    const response = await POST(request(JSON.stringify(validPayload)));

    expect(response.status).toBe(200);
    expect(mappingQuery.eq).toHaveBeenCalledWith("chat_id", "8206591526");
    expect(checkinQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", mood: 4, type: "evening" }),
      { onConflict: "user_id,checkin_date,type" },
    );
    expect(journalQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", checkin_id: "checkin-1" }),
      { onConflict: "user_id,entry_date" },
    );
  });
});
