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

  /** A task row with the given routine (or none), recording whether it was deleted or updated. */
  function taskTable(row: { routine_id: string | null } | null, writeError: { message: string } | null = null) {
    const calls: Array<{ op: string; values?: Record<string, unknown> }> = [];
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
      update: (values: Record<string, unknown>) => { calls.push({ op: "update", values }); return chain; },
      delete: () => { calls.push({ op: "delete" }); return chain; },
      then: (resolve: (value: { error: { message: string } | null }) => void) => resolve({ error: writeError }),
    };
    return { supabase: { from: () => chain }, calls };
  }

  const form = () => { const data = new FormData(); data.set("id", "task-1"); return data; };

  it("deletes an ordinary task", async () => {
    const { supabase, calls } = taskTable({ routine_id: null });
    signIn(supabase);
    expect(await deleteTask(form())).toEqual({ message: "Task deleted." });
    expect(calls).toEqual([{ op: "delete" }]);
  });

  it("skips a routine's session instead of deleting it, so it doesn't come back", async () => {
    const { supabase, calls } = taskTable({ routine_id: "routine-1" });
    signIn(supabase);
    expect(await deleteTask(form())).toEqual({ message: "Skipped this session of the routine." });
    expect(calls).toEqual([{ op: "update", values: { status: "skipped", status_reason: "Skipped this session of the routine." } }]);
  });

  it("returns an error for a task that is already gone, or when the delete fails", async () => {
    const gone = taskTable(null);
    signIn(gone.supabase);
    expect(await deleteTask(form())).toEqual({ error: "That task no longer exists. Refresh the page." });
    expect(gone.calls).toEqual([]);

    const failing = taskTable({ routine_id: null }, { message: "network down" });
    signIn(failing.supabase);
    expect(await deleteTask(form())).toEqual({ error: "Could not delete the task: network down" });
  });
});
