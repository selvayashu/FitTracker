import { describe, expect, it } from "vitest";
import { latestLog, progressPct, validateWeightEntry } from "./weightLogic";

describe("weight logic", () => {
  it("finds the latest log by date", () => {
    expect(latestLog([])).toBeNull();
    expect(latestLog([{ date: "2026-01-02", weight_kg: 70 }, { date: "2026-03-01", weight_kg: 68 }, { date: "2026-02-01", weight_kg: 69 }])?.weight_kg).toBe(68);
  });
  it("validates entries", () => {
    expect(validateWeightEntry("", "2026-01-01", "2026-01-02").error).not.toBeNull();
    expect(validateWeightEntry("10", "2026-01-01", "2026-01-02").error).not.toBeNull();
    expect(validateWeightEntry("401", "2026-01-01", "2026-01-02").error).not.toBeNull();
    expect(validateWeightEntry("70", "2026-01-05", "2026-01-02").error).not.toBeNull();
    expect(validateWeightEntry("70.04", "2026-01-01", "2026-01-02")).toEqual({ error: null, weight: 70 });
  });
  it("computes progress", () => {
    expect(progressPct(80, 76, 72)).toBe(50);
    expect(progressPct(80, 82, 72)).toBe(0);
    expect(progressPct(80, 70, 72)).toBe(100);
    expect(progressPct(72, 72, 72)).toBe(100);
  });
});
