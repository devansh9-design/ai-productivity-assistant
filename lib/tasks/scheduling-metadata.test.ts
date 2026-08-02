import { describe, expect, it } from "vitest";
import { buildTaskSchedulingMetadataUpdate } from "./scheduling-metadata";

function makeFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

describe("buildTaskSchedulingMetadataUpdate", () => {
  it("parses the editable scheduling fields", () => {
    const result = buildTaskSchedulingMetadataUpdate(
      makeFormData({
        urgency: "5",
        impact: "4",
        must_do: "on",
        energy_level: "high",
        estimated_minutes: "90",
      }),
    );

    expect(result).toEqual({
      urgency: 5,
      impact: 4,
      must_do: true,
      energy_level: "high",
      estimated_minutes: 90,
    });
  });

  it("normalizes invalid or blank values without touching unrelated fields", () => {
    const result = buildTaskSchedulingMetadataUpdate(
      makeFormData({
        urgency: "bogus",
        impact: "",
        energy_level: "nope",
        estimated_minutes: "   ",
      }),
    );

    expect(result).toEqual({
      urgency: 3,
      impact: 3,
      must_do: false,
      energy_level: null,
      estimated_minutes: null,
    });
    expect(Object.keys(result).sort()).toEqual([
      "energy_level",
      "estimated_minutes",
      "impact",
      "must_do",
      "urgency",
    ]);
  });
});
