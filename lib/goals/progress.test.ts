import { describe, expect, it } from "vitest";
import { buildMetricSeries, describeFinish, estimateFinish, phaseStatusOn, targetOn } from "./progress";

const TODAY = "2026-10-22";
const dsa = { aggregation: "sum" as const, baseline: 0, target: 300 };
const dsaGoal = { startDate: "2026-10-01", targetDate: "2026-12-31" };

describe("buildMetricSeries", () => {
  it("adds up a summed metric from its baseline on the start day", () => {
    const series = buildMetricSeries(dsa, [{ date: "2026-10-05", value: 4 }, { date: "2026-10-03", value: 2 }], dsaGoal, TODAY)!;
    expect(series.logged).toEqual([{ date: "2026-10-01", value: 0 }, { date: "2026-10-03", value: 2 }, { date: "2026-10-05", value: 6 }]);
    expect(series.targetLine).toEqual({ from: { date: "2026-10-01", value: 0 }, to: { date: "2026-12-31", value: 300 } });
    expect(series).toMatchObject({ start: "2026-10-01", end: "2026-12-31" });
  });

  it("plots each reading for a latest metric, with no target line without dates", () => {
    const series = buildMetricSeries({ aggregation: "latest", baseline: 60, target: 65 }, [{ date: "2026-10-10", value: 61 }, { date: "2026-10-20", value: 61.8 }], { startDate: null, targetDate: null }, TODAY)!;
    expect(series.logged).toEqual([{ date: "2026-10-10", value: 61 }, { date: "2026-10-20", value: 61.8 }]);
    expect(series.targetLine).toBeNull();
    expect(series).toMatchObject({ start: "2026-10-10", end: TODAY });
  });

  it("has nothing to plot without logs", () => {
    expect(buildMetricSeries(dsa, [], dsaGoal, TODAY)).toBeNull();
  });

  it("reads the target pace on any date", () => {
    const line = { from: { date: "2026-10-01", value: 0 }, to: { date: "2026-10-31", value: 300 } };
    expect(targetOn(line, "2026-10-16")).toBe(150);
  });
});

describe("estimateFinish", () => {
  it("carries the pace so far forward and compares it with the target date", () => {
    // 60 of 300 in the first 20 days: 80 more days from the last log, well after 31 Dec.
    const series = buildMetricSeries(dsa, [{ date: "2026-10-21", value: 60 }], dsaGoal, TODAY);
    const estimate = estimateFinish(series, dsa, dsaGoal, TODAY);
    expect(estimate).toEqual({ kind: "estimate", date: "2027-01-10", daysVsTarget: 10 });
    expect(describeFinish(estimate)).toBe("At this pace: about 10 days late.");
  });

  it("works when the target is below the baseline (losing weight)", () => {
    const metric = { aggregation: "latest" as const, baseline: 80, target: 70 };
    const goal = { startDate: "2026-10-01", targetDate: "2026-12-31" };
    const series = buildMetricSeries(metric, [{ date: "2026-10-01", value: 80 }, { date: "2026-10-21", value: 76 }], goal, TODAY);
    // 4 of 10 kg in 20 days: 30 more days from today (21 Nov), 40 days before the target date.
    expect(describeFinish(estimateFinish(series, metric, goal, TODAY))).toBe("At this pace: about 6 weeks early.");
  });

  it("says done, not moving, or why there is no estimate", () => {
    expect(estimateFinish(buildMetricSeries(dsa, [{ date: "2026-10-20", value: 300 }], dsaGoal, TODAY), dsa, dsaGoal, TODAY)).toEqual({ kind: "done" });
    const flat = { aggregation: "latest" as const, baseline: 80, target: 70 };
    expect(estimateFinish(buildMetricSeries(flat, [{ date: "2026-10-05", value: 80 }, { date: "2026-10-20", value: 81 }], dsaGoal, TODAY), flat, dsaGoal, TODAY)).toEqual({ kind: "not_moving" });
    expect(estimateFinish(null, dsa, dsaGoal, TODAY)).toMatchObject({ kind: "unknown" });
    expect(estimateFinish(buildMetricSeries(dsa, [{ date: "2026-10-02", value: 3 }], dsaGoal, TODAY), dsa, dsaGoal, TODAY)).toMatchObject({ kind: "unknown" });
    expect(describeFinish({ kind: "estimate", date: "2027-01-01", daysVsTarget: 1 })).toBe("At this pace: on time.");
  });
});

describe("phaseStatusOn", () => {
  it("reads done, now or upcoming from the dates", () => {
    expect(phaseStatusOn({ start_date: "2026-10-01", end_date: "2026-10-21" }, TODAY)).toBe("completed");
    expect(phaseStatusOn({ start_date: "2026-10-01", end_date: "2026-10-22" }, TODAY)).toBe("active");
    expect(phaseStatusOn({ start_date: "2026-10-23", end_date: "2026-11-01" }, TODAY)).toBe("upcoming");
  });
});
