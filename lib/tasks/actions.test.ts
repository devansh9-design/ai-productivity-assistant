import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteTask, updateTaskStatus } from "@/lib/tasks/actions";
import * as authModule from "@/lib/auth/require-user";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** Records the order of database calls updateTaskStatus makes. */
function fakeSupabase(openSessionIds: string[], stopError: { message: string } | null = null) {
  const calls: string[] = [];
  const sessions = {
    select: () => sessions,
    eq: () => sessions,
    is: () => {
      calls.push("load open sessions");
      return Promise.resolve({ data: openSessionIds.map((id) => ({ id })), error: null });
    },
  };
  const tasks = {
    update: (values: { status: string }) => {
      calls.push(`update status to ${values.status}`);
      return tasks;
    },
    eq: () => tasks,
    then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
  };
  const supabase = {
    from: (table: string) => (table === "task_sessions" ? sessions : tasks),
    rpc: (name: string, args: { p_task_session_id: string }) => {
      calls.push(`${name} ${args.p_task_session_id}`);
      return Promise.resolve({ error: stopError });
    },
  };
  return { supabase, calls };
}

function statusForm(status: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("id", "task-1");
  form.set("status", status);
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

function signIn(supabase: unknown) {
  vi.spyOn(authModule, "requireUser").mockResolvedValue({ supabase, user: { id: "user-1" } } as never);
}

describe("updateTaskStatus timers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stops every running timer before completing the task", async () => {
    const { supabase, calls } = fakeSupabase(["s1", "s2"]);
    signIn(supabase);
    await updateTaskStatus(statusForm("completed", { actual_minutes: "99" }));
    expect(calls).toEqual(["load open sessions", "stop_task_session s1", "stop_task_session s2", "update status to completed"]);
  });

  it("also stops timers when skipping or deferring", async () => {
    for (const status of ["skipped", "deferred"]) {
      const { supabase, calls } = fakeSupabase(["s1"]);
      signIn(supabase);
      await updateTaskStatus(statusForm(status, { reason: "Too tired" }));
      expect(calls).toEqual(["load open sessions", "stop_task_session s1", `update status to ${status}`]);
    }
  });

  it("leaves timers alone when reopening a task", async () => {
    const { supabase, calls } = fakeSupabase(["s1"]);
    signIn(supabase);
    await updateTaskStatus(statusForm("todo"));
    expect(calls).toEqual(["update status to todo"]);
  });

  it("keeps the status unchanged if a timer cannot be stopped", async () => {
    const { supabase, calls } = fakeSupabase(["s1"], { message: "network down" });
    signIn(supabase);
    await expect(updateTaskStatus(statusForm("completed"))).rejects.toThrow("Could not stop the running timer: network down");
    expect(calls).not.toContain("update status to completed");
  });
});

describe("deleteTask", () => {
  afterEach(() => vi.restoreAllMocks());

  /** A task row with the given routine, recording whether it was deleted or updated. */
  function taskTable(routineId: string | null) {
    const calls: Array<{ op: string; values?: Record<string, unknown> }> = [];
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: { routine_id: routineId }, error: null }),
      update: (values: Record<string, unknown>) => { calls.push({ op: "update", values }); return chain; },
      delete: () => { calls.push({ op: "delete" }); return chain; },
      then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
    };
    return { supabase: { from: () => chain }, calls };
  }

  const form = () => { const data = new FormData(); data.set("id", "task-1"); return data; };

  it("deletes an ordinary task", async () => {
    const { supabase, calls } = taskTable(null);
    signIn(supabase);
    await deleteTask(form());
    expect(calls).toEqual([{ op: "delete" }]);
  });

  it("skips a routine's session instead of deleting it, so it doesn't come back", async () => {
    const { supabase, calls } = taskTable("routine-1");
    signIn(supabase);
    await deleteTask(form());
    expect(calls).toEqual([{ op: "update", values: { status: "skipped", status_reason: "Skipped this session of the routine." } }]);
  });
});
