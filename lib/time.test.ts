import { describe, it, expect } from "vitest";
import { minutesFromHHMM } from "@/lib/time";

describe("minutesFromHHMM", () => {
  it("reads HH:mm and Postgres HH:mm:ss times", () => {
    expect(minutesFromHHMM("00:00")).toBe(0);
    expect(minutesFromHHMM("13:30")).toBe(810);
    expect(minutesFromHHMM("23:59:00")).toBe(1439);
    expect(minutesFromHHMM("09:05:30.5")).toBe(545);
  });

  it("rejects anything that is not a time of day", () => {
    for (const value of ["", "9:00", "24:00", "12:60", "13:30abc", "13:30:7", "noon"]) {
      expect(minutesFromHHMM(value)).toBeNull();
    }
  });
});
