import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient }));

import { POST as commandPost } from "./command/route";
import { POST as planPost } from "./plan/route";
import { POST as todayPost } from "./today/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/telegram/today", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-checkin-secret": "test-secret",
    },
    body: JSON.stringify(body),
  });
}

describe("Telegram plan routes", () => {
  const rpc = vi.fn();
  const from = vi.fn();

  beforeEach(() => {
    process.env.TELEGRAM_CHECKIN_WEBHOOK_SECRET = "test-secret";
    rpc.mockReset().mockResolvedValue({ data: { ok: true, plan: null, blocks: [], unscheduled: [] }, error: null });
    createServiceRoleClient.mockReset().mockReturnValue({ rpc, from });
  });

  it.each([
    ["today", todayPost],
    ["plan", planPost],
  ])("uses the service-role client for %s", async (_, handler) => {
    const response = await handler(request({ chat_id: 8206591526, time_zone: "Asia/Kolkata" }));

    expect(response.status).toBe(200);
    expect(createServiceRoleClient).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("telegram_today", expect.objectContaining({ p_chat_id: "8206591526" }));
  });

  it("keeps command routing behind the service-role client", async () => {
    const response = await commandPost(request({ chat_id: 8206591526, command: "/today" }));

    expect(response.status).toBe(200);
    expect(createServiceRoleClient).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("telegram_today", expect.any(Object));
  });

  it.each([
    ["today", todayPost],
    ["plan", planPost],
    ["command", commandPost],
  ])("rejects an impossible date in %s", async (_, handler) => {
    const response = await handler(request({ chat_id: 8206591526, plan_date: "2026-02-30" }));

    expect(response.status).toBe(400);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });
});
