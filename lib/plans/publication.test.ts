import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmPlan } from "@/lib/plans/actions";
import * as authModule from "@/lib/auth/require-user";
import * as oauthModule from "@/lib/google/oauth";
import * as plannerModule from "@/lib/google/planner-calendar";
import * as serviceRoleModule from "@/lib/supabase/service-role";
import { cookies } from "next/headers";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type PlanStatus = "draft" | "publishing" | "publication_failed" | "confirmed";
type Mapping = { id: string; daily_plan_id: string; plan_block_id: string; google_event_id: string };

const plan = (status: PlanStatus = "draft") => ({
  id: "plan-1", user_id: "user-1", plan_date: "2026-10-07", status,
  buffer_minutes: 0, version: 1, parent_plan_id: null,
});

const blocks = [
  { id: "block-1", user_id: "user-1", daily_plan_id: "plan-1", task_id: "task-1", kind: "task", title: "First", start_time: "09:00:00", end_time: "10:00:00", sort_order: 0, is_manual: false },
  { id: "block-2", user_id: "user-1", daily_plan_id: "plan-1", task_id: "task-2", kind: "task", title: "Second", start_time: "10:00:00", end_time: "11:00:00", sort_order: 1, is_manual: false },
];

function resolved<T>(data: T, error: unknown = null) {
  return { single: vi.fn().mockResolvedValue({ data, error }) };
}

function makeDb(options: {
  currentPlan?: ReturnType<typeof plan>;
  mappings?: Mapping[];
  rpcErrors?: Record<string, unknown>;
  blockError?: unknown;
  mappingInsertError?: unknown;
}) {
  const currentPlan = options.currentPlan ?? plan("publishing");
  const mappings = [...(options.mappings ?? [])];
  const rpcCalls: string[] = [];
  const mappingRows = { value: mappings };

  const blockQuery = {
    eq: vi.fn().mockReturnThis(),
    returns: vi.fn().mockResolvedValue({ data: blocks, error: options.blockError ?? null }),
  };
  const planQuery = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [{ id: "plan-1" }], error: null }),
  };
  const mappingSelectQuery = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: mappingRows.value, error: null }),
  };
  const mappingDeleteQuery = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ error: null }),
  };
  const mappingRowMutation = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ error: null }),
  };
  const serviceFrom = vi.fn((table: string) => {
    if (table === "daily_plans") return { select: vi.fn().mockReturnValue(planQuery) };
    if (table === "google_planner_events") {
      return {
        select: vi.fn().mockReturnValue(mappingSelectQuery),
        delete: vi.fn().mockReturnValue(mappingDeleteQuery),
        update: vi.fn().mockReturnValue(mappingRowMutation),
        insert: vi.fn().mockReturnValue(options.mappingInsertError ? Promise.resolve({ error: options.mappingInsertError }) : Promise.resolve({ error: null })),
      };
    }
    throw new Error(`Unexpected service table: ${table}`);
  });
  const serviceRole = { from: serviceFrom };

  const supabase = {
    rpc: vi.fn((name: string) => {
      rpcCalls.push(name);
      const rpcError = options.rpcErrors?.[name];
      if (rpcError) return resolved(null, rpcError);
      if (name === "begin_daily_plan_publication") return resolved(currentPlan);
      if (name === "fail_daily_plan_publication") return resolved(plan("publication_failed"));
      if (name === "complete_daily_plan_publication") return resolved(plan("confirmed"));
      throw new Error(`Unexpected RPC: ${name}`);
    }),
    from: vi.fn((table: string) => {
      if (table === "plan_blocks") return { select: vi.fn().mockReturnValue(blockQuery) };
      if (table === "ai_conversations") return { update: vi.fn() };
      throw new Error(`Unexpected user table: ${table}`);
    }),
  };

  vi.spyOn(authModule, "requireUser").mockResolvedValue({ user: { id: "user-1" }, supabase } as never);
  vi.spyOn(oauthModule, "getValidAccessToken").mockResolvedValue({ token: "access-token" });
  vi.spyOn(plannerModule, "getOrCreatePlannerCalendar").mockResolvedValue("planner-calendar");
  vi.spyOn(plannerModule, "createPlannerEvent").mockImplementation(async (_token, _calendar, input) => `google-${input.planBlockId}`);
  vi.spyOn(plannerModule, "updatePlannerEvent").mockResolvedValue();
  vi.spyOn(plannerModule, "deletePlannerEvent").mockResolvedValue();
  vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: "Asia/Kolkata" }) } as never);

  return { supabase, serviceRole, rpcCalls, mappingRows };
}

function confirmationForm() {
  const form = new FormData();
  form.set("plan_id", "plan-1");
  return form;
}

beforeEach(() => {
  vi.spyOn(authModule, "requireUser");
  vi.spyOn(oauthModule, "getValidAccessToken");
  vi.spyOn(plannerModule, "getOrCreatePlannerCalendar");
  vi.spyOn(plannerModule, "createPlannerEvent");
  vi.spyOn(plannerModule, "updatePlannerEvent");
  vi.spyOn(plannerModule, "deletePlannerEvent");
});

afterEach(() => vi.restoreAllMocks());

describe("confirmPlan publication state machine", () => {
  it("publishes all blocks and completes the plan without duplicates", async () => {
    const db = makeDb({ mappings: [] });
    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue(db.serviceRole as never);

    await confirmPlan(confirmationForm());

    expect(db.rpcCalls).toEqual(["begin_daily_plan_publication", "complete_daily_plan_publication"]);
    expect(plannerModule.createPlannerEvent).toHaveBeenCalledTimes(2);
    expect(plannerModule.updatePlannerEvent).not.toHaveBeenCalled();
  });

  it("marks publication_failed when Google fails before creating an event", async () => {
    const db = makeDb({ mappings: [] });
    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue(db.serviceRole as never);
    vi.mocked(plannerModule.createPlannerEvent).mockRejectedValueOnce(new Error("Google unavailable"));

    await expect(confirmPlan(confirmationForm())).rejects.toThrow("Publishing to AI Planner failed");
    expect(db.rpcCalls).toContain("fail_daily_plan_publication");
    expect(db.rpcCalls).not.toContain("complete_daily_plan_publication");
  });

  it("updates existing mappings and recreates only a missing external event", async () => {
    const db = makeDb({ mappings: [
      { id: "mapping-1", daily_plan_id: "plan-1", plan_block_id: "block-1", google_event_id: "google-existing" },
      { id: "mapping-2", daily_plan_id: "plan-1", plan_block_id: "block-2", google_event_id: "google-deleted" },
    ] });
    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue(db.serviceRole as never);
    vi.mocked(plannerModule.updatePlannerEvent)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("AI Planner event google-deleted no longer exists."));

    await confirmPlan(confirmationForm());

    expect(plannerModule.updatePlannerEvent).toHaveBeenCalledTimes(2);
    expect(plannerModule.createPlannerEvent).toHaveBeenCalledTimes(1);
    expect(db.rpcCalls).toContain("complete_daily_plan_publication");
  });

  it("removes stale mappings before completing publication", async () => {
    const db = makeDb({ mappings: [
      { id: "stale", daily_plan_id: "old-plan", plan_block_id: "old-block", google_event_id: "old-google" },
    ] });
    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue(db.serviceRole as never);

    await confirmPlan(confirmationForm());

    expect(plannerModule.deletePlannerEvent).toHaveBeenCalledWith("access-token", "planner-calendar", "old-google");
    expect(db.rpcCalls).toContain("complete_daily_plan_publication");
  });

  it("does not complete the plan when mapping insertion fails", async () => {
    const db = makeDb({ mappings: [], mappingInsertError: new Error("mapping insert failed") });
    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue(db.serviceRole as never);

    await expect(confirmPlan(confirmationForm())).rejects.toThrow("local mapping could not be saved");
    expect(plannerModule.deletePlannerEvent).toHaveBeenCalledWith("access-token", "planner-calendar", "google-block-1");
    expect(db.rpcCalls).toContain("fail_daily_plan_publication");
    expect(db.rpcCalls).not.toContain("complete_daily_plan_publication");
  });

  it("rejects an already confirmed plan at the state-transition boundary", async () => {
    const db = makeDb({ rpcErrors: { begin_daily_plan_publication: new Error("Only draft or failed plans can be published") } });
    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue(db.serviceRole as never);

    await expect(confirmPlan(confirmationForm())).rejects.toThrow("Only draft or failed plans can be published");
    expect(plannerModule.createPlannerEvent).not.toHaveBeenCalled();
  });

  it("leaves the first event recoverable when a later event fails", async () => {
    const db = makeDb({ mappings: [] });
    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue(db.serviceRole as never);
    vi.mocked(plannerModule.createPlannerEvent)
      .mockResolvedValueOnce("google-block-1")
      .mockRejectedValueOnce(new Error("second event failed"));

    await expect(confirmPlan(confirmationForm())).rejects.toThrow("Publishing to AI Planner failed");
    expect(plannerModule.createPlannerEvent).toHaveBeenCalledTimes(2);
    expect(db.rpcCalls).toContain("fail_daily_plan_publication");
    expect(db.rpcCalls).not.toContain("complete_daily_plan_publication");
  });

  it("reuses persisted mappings when the same plan is confirmed again", async () => {
    const db = makeDb({ mappings: [
      { id: "mapping-1", daily_plan_id: "plan-1", plan_block_id: "block-1", google_event_id: "google-block-1" },
      { id: "mapping-2", daily_plan_id: "plan-1", plan_block_id: "block-2", google_event_id: "google-block-2" },
    ] });
    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue(db.serviceRole as never);

    await confirmPlan(confirmationForm());
    await confirmPlan(confirmationForm());

    expect(plannerModule.createPlannerEvent).not.toHaveBeenCalled();
    expect(plannerModule.updatePlannerEvent).toHaveBeenCalledTimes(4);
    expect(db.rpcCalls.filter((name) => name === "complete_daily_plan_publication")).toHaveLength(2);
  });

  it("protects a recent publishing attempt", async () => {
    const recentDb = makeDb({ rpcErrors: { begin_daily_plan_publication: new Error("publication is still active") } });
    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue(recentDb.serviceRole as never);
    await expect(confirmPlan(confirmationForm())).rejects.toThrow("publication is still active");
    expect(plannerModule.createPlannerEvent).not.toHaveBeenCalled();
  });

  it("permits a stale retry and reuses valid mappings", async () => {
    const staleDb = makeDb({ mappings: [
      { id: "mapping-1", daily_plan_id: "plan-1", plan_block_id: "block-1", google_event_id: "google-block-1" },
      { id: "mapping-2", daily_plan_id: "plan-1", plan_block_id: "block-2", google_event_id: "google-block-2" },
    ] });
    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue(staleDb.serviceRole as never);
    await confirmPlan(confirmationForm());
    expect(plannerModule.createPlannerEvent).not.toHaveBeenCalled();
    expect(staleDb.rpcCalls).toContain("complete_daily_plan_publication");
  });
});
