import { describe, expect, it } from "vitest";
import type { ProfileRow } from "./database.types";
import { fetchAllPages, mapActivity, toReportProfile } from "./rangeData";

describe("fetchAllPages", () => {
  const make = (total: number) => async (from: number, to: number) => ({
    data: Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i),
    error: null,
  });
  it("collects every page and stops on a short page", async () => {
    const rows = await fetchAllPages(make(2500), 1000);
    expect(rows).toHaveLength(2500);
    expect(rows[0]).toBe(0);
    expect(rows[2499]).toBe(2499);
  });
  it("handles an exact multiple of the page size with one extra empty request", async () => {
    let calls = 0;
    const f = make(2000);
    const rows = await fetchAllPages(async (a, b) => { calls++; return f(a, b); }, 1000);
    expect(rows).toHaveLength(2000);
    expect(calls).toBe(3);
  });
  it("returns an empty list for no rows", async () => expect(await fetchAllPages(make(0), 1000)).toEqual([]));
  it("throws the server error", async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});

describe("mapActivity", () => {
  const base = { id: "a", start_time: "2026-03-10T01:00:00Z", activity_type_id: 1, custom_name: null, name: null, source: "manual" as const,
    duration_min: 30, distance_km: null, avg_hr: null, max_hr: null, calories: 100, calories_estimated: true, excluded: false };
  const z = { zone1_s: 1, zone2_s: 2, zone3_s: 3, zone4_s: 4, zone5_s: 5 };
  it("accepts an object, an array and null for the zones embed", () => {
    expect(mapActivity({ ...base, activity_hr_zones: z }).zones).toEqual(z);
    expect(mapActivity({ ...base, activity_hr_zones: [z] }).zones).toEqual(z);
    expect(mapActivity({ ...base, activity_hr_zones: [] }).zones).toBeNull();
    expect(mapActivity({ ...base, activity_hr_zones: null }).zones).toBeNull();
    expect("activity_hr_zones" in mapActivity({ ...base, activity_hr_zones: z })).toBe(false);
  });
});

describe("toReportProfile", () => {
  const row = { user_id: "u", name: null, sex: "female", dob: "1994-01-15", height_cm: 162, weight_kg: 68, target_weight_kg: 60,
    activity_level: "light", goal: "lose", pace: 0.5, bmi_standard: "asian", activity_tracking_mode: "manual", exercise_addback_pct: 50,
    max_hr: 188, bmi: 25.9, bmr: 1372, tdee: 1886, daily_kcal_target: 1372, protein_target_g: 95, carb_target_g: 160, fat_target_g: 42,
    onboarded: true, created_at: "", updated_at: "" } as ProfileRow;
  it("maps a complete profile", () => {
    expect(toReportProfile(row)).toMatchObject({ sex: "female", heightCm: 162, dailyKcalTarget: 1372, exerciseAddbackPct: 50, proteinTargetG: 95 });
  });
  it("returns null when a required field is missing", () => {
    expect(toReportProfile(null)).toBeNull();
    expect(toReportProfile({ ...row, daily_kcal_target: null })).toBeNull();
    expect(toReportProfile({ ...row, dob: null })).toBeNull();
  });
});
