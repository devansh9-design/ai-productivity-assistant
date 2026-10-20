import { describe, it, expect } from "vitest";
import { buildUserDataExport, EXPORT_TABLES } from "@/lib/export/data";

type Result = { data: unknown[] | null; error: { message: string } | null };

/** A client whose tables answer from `pages` (one array of results per table) and records each request. */
function fakeClient(pages: Record<string, Result[]>) {
  const requests: Array<{ table: string; orderBy: string; from: number; to: number }> = [];
  const supabase = {
    from: (table: string) => ({
      select: () => ({
        order: (orderBy: string) => ({
          range: (from: number, to: number) => {
            requests.push({ table, orderBy, from, to });
            const queue = pages[table] ?? [];
            return Promise.resolve(queue.shift() ?? { data: [], error: null });
          },
        }),
      }),
    }),
  };
  return { supabase, requests };
}

describe("buildUserDataExport", () => {
  it("exports every listed table and never the token or rate-limit tables", async () => {
    const { supabase, requests } = fakeClient({ tasks: [{ data: [{ id: "t1" }], error: null }] });
    const result = await buildUserDataExport(supabase as never, { id: "u1", email: "me@test" }, new Date("2026-10-19T09:00:00Z"));
    expect(Object.keys(result.tables)).toEqual(EXPORT_TABLES.map((entry) => entry.table));
    expect(result.tables.tasks).toEqual([{ id: "t1" }]);
    expect(result).toMatchObject({ version: 1, exported_at: "2026-10-19T09:00:00.000Z", user: { id: "u1", email: "me@test" } });
    const read = new Set(requests.map((request) => request.table));
    for (const hidden of ["google_credentials", "google_planner_events", "google_planner_calendars", "ai_request_log", "telegram_chat_mappings"]) {
      expect(read.has(hidden)).toBe(false);
    }
  });

  it("reads past the 1000-row page limit", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, index) => ({ id: index }));
    const { supabase, requests } = fakeClient({ tasks: [{ data: fullPage, error: null }, { data: [{ id: 1000 }], error: null }] });
    const result = await buildUserDataExport(supabase as never, { id: "u1" });
    expect(result.tables.tasks).toHaveLength(1001);
    expect(requests.filter((request) => request.table === "tasks").map((request) => request.from)).toEqual([0, 1000]);
  });

  it("fails instead of returning a partial backup", async () => {
    const { supabase } = fakeClient({ goals: [{ data: null, error: { message: "timeout" } }] });
    await expect(buildUserDataExport(supabase as never, { id: "u1" })).rejects.toThrow("Could not export goals: timeout");
  });
});
