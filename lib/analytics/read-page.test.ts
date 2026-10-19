import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAnalyticsPage } from "@/lib/analytics/read-page";

const futureJwt = { data: null, error: { code: "PGRST303", message: "JWT issued at future" } };
const success = { data: [{ id: "task" }], error: null };

describe("Analytics read recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("returns successful reads without delay", async () => {
    const read = vi.fn().mockResolvedValue(success);
    expect(await readAnalyticsPage(read)).toEqual(success);
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rebuilds the read after a timing rejection and returns only the successful data", async () => {
    const read = vi.fn().mockResolvedValueOnce({ ...futureJwt, data: [{ id: "discard" }] }).mockResolvedValue(success);
    const pending = readAnalyticsPage(read);
    await vi.advanceTimersByTimeAsync(999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(success);
    expect(read).toHaveBeenCalledTimes(2);
    expect(console.info).toHaveBeenCalledTimes(1);
  });

  it("allows recovery on the final attempt", async () => {
    const read = vi.fn().mockResolvedValueOnce(futureJwt).mockResolvedValueOnce(futureJwt).mockResolvedValue(success);
    const pending = readAnalyticsPage(read);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toEqual(success);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("returns a persistent auth failure after three attempts without hiding it", async () => {
    const read = vi.fn().mockResolvedValue(futureJwt);
    const pending = readAnalyticsPage(read);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toEqual(futureJwt);
    expect(read).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: "PGRST303", message: "JWT expired" },
    { code: "PGRST301", message: "JWT issued at future" },
    { code: "42501", message: "permission denied" },
    { message: "JWT issued at future" },
  ])("does not retry other errors: $message ($code)", async (error) => {
    const result = { data: null, error };
    const read = vi.fn().mockResolvedValue(result);
    expect(await readAnalyticsPage(read)).toEqual(result);
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops when a retry returns a different auth failure", async () => {
    const expired = { data: null, error: { code: "PGRST303", message: "JWT expired" } };
    const read = vi.fn().mockResolvedValueOnce(futureJwt).mockResolvedValue(expired);
    const pending = readAnalyticsPage(read);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual(expired);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
