import { describe, expect, it } from "vitest";
import { filterTasks, getCompletedToday, getTodayTasks, getTopPriorities } from "./filters";
import { addDaysToISODate, getTodayISODate } from "./timezone";
import type { Task } from "@/lib/types";

const TODAY = "2026-07-30";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    user_id: "user-1",
    goal_id: null,
    project_id: null,
    milestone_id: null,
    title: "Task",
    description: null,
    category: null,
    status: "todo",
    priority: "medium",
    urgency: 3,
    impact: 3,
    must_do: false,
    estimated_minutes: null,
    actual_minutes: null,
    due_date: null,
    energy_level: null,
    status_reason: null,
    created_at: `${TODAY}T09:00:00.000Z`,
    updated_at: `${TODAY}T09:00:00.000Z`,
    completed_at: null,
    ...overrides,
  };
}

describe("filterTasks", () => {
  const tasks: Task[] = [
    makeTask({ id: "no-date", due_date: null }),
    makeTask({ id: "today", due_date: "2026-07-30" }),
    makeTask({ id: "due-soon", due_date: "2026-08-01" }),
    makeTask({ id: "far-future", due_date: "2026-09-01" }),
    makeTask({ id: "overdue", due_date: "2026-07-20" }),
    makeTask({ id: "completed", due_date: "2026-07-20", status: "completed" }),
    makeTask({ id: "skipped", due_date: "2026-07-20", status: "skipped" }),
  ];

  it("inbox includes every open task regardless of date", () => {
    const result = filterTasks(tasks, "inbox", TODAY).map((t) => t.id);
    expect(result).toEqual(["no-date", "today", "due-soon", "far-future", "overdue"]);
  });

  it("today includes only tasks due today", () => {
    const result = filterTasks(tasks, "today", TODAY).map((t) => t.id);
    expect(result).toEqual(["today"]);
  });

  it("due-soon includes tasks due within the window, excluding today", () => {
    const result = filterTasks(tasks, "due-soon", TODAY).map((t) => t.id);
    expect(result).toEqual(["due-soon"]);
  });

  it("overdue includes only open tasks with a past due date", () => {
    const result = filterTasks(tasks, "overdue", TODAY).map((t) => t.id);
    expect(result).toEqual(["overdue"]);
  });

  it("completed includes completed tasks even with a past due date", () => {
    const result = filterTasks(tasks, "completed", TODAY).map((t) => t.id);
    expect(result).toEqual(["completed"]);
  });

  it("skipped tasks are excluded from inbox, due windows, and completed", () => {
    const inbox = filterTasks(tasks, "inbox", TODAY).map((t) => t.id);
    const completed = filterTasks(tasks, "completed", TODAY).map((t) => t.id);
    expect(inbox).not.toContain("skipped");
    expect(completed).not.toContain("skipped");
  });
});

describe("filterTasks timezone and calendar edge cases", () => {
  it("a task due 'today' in the user's timezone is not overdue near UTC midnight", () => {
    // 2026-07-30 23:30 UTC is already 2026-07-31 in UTC+1, and still
    // 2026-07-30 in UTC-8. The filter must follow the user's calendar day,
    // not whatever the server process's local clock happens to read.
    const nowNearMidnightUTC = new Date("2026-07-30T23:30:00.000Z");

    const todayInTokyo = getTodayISODate("Asia/Tokyo", nowNearMidnightUTC); // UTC+9
    const todayInLosAngeles = getTodayISODate("America/Los_Angeles", nowNearMidnightUTC); // UTC-7/-8

    expect(todayInTokyo).toBe("2026-07-31");
    expect(todayInLosAngeles).toBe("2026-07-30");

    const tasks = [makeTask({ id: "due-31st", due_date: "2026-07-31" })];

    expect(filterTasks(tasks, "today", todayInTokyo).map((t) => t.id)).toEqual(["due-31st"]);
    expect(filterTasks(tasks, "today", todayInLosAngeles).map((t) => t.id)).toEqual([]);
    expect(filterTasks(tasks, "overdue", todayInLosAngeles).map((t) => t.id)).toEqual([]);
  });

  it("computes the correct local date across a DST transition", () => {
    // US DST spring-forward: 2027-03-14 02:00 local becomes 03:00 in
    // America/New_York. A naive server-local Date construction is prone to
    // off-by-one errors right at the transition; the Intl-based formatter
    // used by getTodayISODate is not.
    const justBeforeSpringForwardUTC = new Date("2027-03-14T06:59:00.000Z"); // 01:59 EST
    const justAfterSpringForwardUTC = new Date("2027-03-14T07:01:00.000Z"); // 03:01 EDT

    expect(getTodayISODate("America/New_York", justBeforeSpringForwardUTC)).toBe("2027-03-14");
    expect(getTodayISODate("America/New_York", justAfterSpringForwardUTC)).toBe("2027-03-14");
  });

  it("due-soon window correctly crosses a leap day", () => {
    const today = "2028-02-27"; // 2028 is a leap year
    const tasks = [
      makeTask({ id: "leap-day", due_date: "2028-02-29" }),
      makeTask({ id: "day-after-leap", due_date: "2028-03-01" }),
    ];

    expect(addDaysToISODate(today, 3)).toBe("2028-03-01");
    expect(filterTasks(tasks, "due-soon", today).map((t) => t.id)).toEqual([
      "leap-day",
      "day-after-leap",
    ]);
  });

  it("addDaysToISODate correctly rolls over a non-leap year end", () => {
    expect(addDaysToISODate("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("getTodayISODate falls back to UTC for an unrecognized timezone", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    expect(getTodayISODate("Not/ARealZone", now)).toBe(getTodayISODate("UTC", now));
  });
});

describe("getTodayTasks", () => {
  const tasks: Task[] = [
    makeTask({ id: "no-date", due_date: null }),
    makeTask({ id: "today", due_date: "2026-07-30" }),
    makeTask({ id: "overdue", due_date: "2026-07-20" }),
    makeTask({ id: "future", due_date: "2026-08-05" }),
    makeTask({ id: "completed-today", due_date: "2026-07-30", status: "completed" }),
    makeTask({ id: "skipped-today", due_date: "2026-07-30", status: "skipped" }),
    makeTask({ id: "deferred-today", due_date: "2026-07-30", status: "deferred" }),
  ];

  it("includes only open tasks due today or earlier", () => {
    const result = getTodayTasks(tasks, "2026-07-30").map((t) => t.id);
    expect(result).toEqual(["today", "overdue"]);
  });

  it("excludes tasks with no due date, future due dates, and non-open statuses", () => {
    const result = getTodayTasks(tasks, "2026-07-30").map((t) => t.id);
    expect(result).not.toContain("no-date");
    expect(result).not.toContain("future");
    expect(result).not.toContain("completed-today");
    expect(result).not.toContain("skipped-today");
    expect(result).not.toContain("deferred-today");
  });
});

describe("getTopPriorities", () => {
  it("ranks urgent > high > medium > low", () => {
    const tasks: Task[] = [
      makeTask({ id: "low", priority: "low" }),
      makeTask({ id: "urgent", priority: "urgent" }),
      makeTask({ id: "medium", priority: "medium" }),
      makeTask({ id: "high", priority: "high" }),
    ];
    expect(getTopPriorities(tasks, 4).map((t) => t.id)).toEqual(["urgent", "high", "medium", "low"]);
  });

  it("breaks priority ties by earlier due date, then by creation order", () => {
    const tasks: Task[] = [
      makeTask({ id: "b", priority: "high", due_date: "2026-07-30", created_at: "2026-07-29T10:00:00.000Z" }),
      makeTask({ id: "a", priority: "high", due_date: "2026-07-20", created_at: "2026-07-29T11:00:00.000Z" }),
      makeTask({ id: "c", priority: "high", due_date: null, created_at: "2026-07-29T09:00:00.000Z" }),
    ];
    expect(getTopPriorities(tasks, 3).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("limits to the requested count", () => {
    const tasks: Task[] = [
      makeTask({ id: "1", priority: "urgent" }),
      makeTask({ id: "2", priority: "urgent" }),
      makeTask({ id: "3", priority: "urgent" }),
      makeTask({ id: "4", priority: "urgent" }),
    ];
    expect(getTopPriorities(tasks, 3)).toHaveLength(3);
  });
});

describe("getCompletedToday", () => {
  it("includes only completed tasks finished today in the given timezone", () => {
    const tasks: Task[] = [
      makeTask({ id: "done-today", status: "completed", completed_at: "2026-07-30T18:00:00.000Z" }),
      makeTask({ id: "done-yesterday", status: "completed", completed_at: "2026-07-29T18:00:00.000Z" }),
      makeTask({ id: "still-open", status: "todo", completed_at: null }),
    ];
    const result = getCompletedToday(tasks, "2026-07-30", "UTC").map((t) => t.id);
    expect(result).toEqual(["done-today"]);
  });

  it("resolves 'today' in the caller's timezone, not UTC", () => {
    // 2026-07-30 23:30 UTC is already 2026-07-31 in Tokyo (UTC+9).
    const tasks: Task[] = [
      makeTask({ id: "late-utc-completion", status: "completed", completed_at: "2026-07-30T23:30:00.000Z" }),
    ];
    expect(getCompletedToday(tasks, "2026-07-31", "Asia/Tokyo").map((t) => t.id)).toEqual([
      "late-utc-completion",
    ]);
    expect(getCompletedToday(tasks, "2026-07-30", "Asia/Tokyo").map((t) => t.id)).toEqual([]);
  });
});
