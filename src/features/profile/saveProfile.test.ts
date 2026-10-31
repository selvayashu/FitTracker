import { describe, expect, it } from "vitest";
import { computeProfileDerived, type ProfileInput } from "@fittrack/shared";
import { buildDerivedColumns, buildProfileUpdate, cmToFtIn, ftInToCm } from "./saveProfile";

const now = new Date("2026-06-01T00:00:00Z");
const input: ProfileInput = {
  sex: "male", dob: "1996-06-01", heightCm: 175, weightKg: 80, targetWeightKg: 72,
  activityLevel: "light", goal: "lose", pace: 0.5, bmiStandard: "asian",
};

describe("buildProfileUpdate", () => {
  it("writes derived columns that match computeProfileDerived", () => {
    const d = computeProfileDerived(input, now);
    const u = buildProfileUpdate(input, null, now);
    expect(u.bmi).toBe(d.bmi);
    expect(u.bmr).toBe(d.bmr);
    expect(u.tdee).toBe(d.tdee);
    expect(u.daily_kcal_target).toBe(d.dailyKcalTarget);
    expect(u.protein_target_g).toBe(d.macros.proteinG);
    expect(u.carb_target_g).toBe(d.macros.carbsG);
    expect(u.fat_target_g).toBe(d.macros.fatG);
    expect(u.max_hr).toBe(d.maxHr);
  });
  it("maps input columns and sets onboarded", () => {
    const u = buildProfileUpdate({ ...input, name: "Asha", activityTrackingMode: "manual", exerciseAddbackPct: 50 }, null, now);
    expect(u).toMatchObject({ name: "Asha", sex: "male", height_cm: 175, weight_kg: 80, target_weight_kg: 72, goal: "lose", pace: 0.5, activity_tracking_mode: "manual", exercise_addback_pct: 50, onboarded: true });
  });
  it("omits optional columns that were not supplied", () => {
    const u = buildProfileUpdate(input, null, now);
    expect(u).not.toHaveProperty("name");
    expect(u).not.toHaveProperty("exercise_addback_pct");
  });
  it("preserves an existing max_hr", () => {
    expect(buildProfileUpdate(input, 188, now).max_hr).toBe(188);
    expect(buildDerivedColumns(input, 150, now).max_hr).toBe(150);
  });
  it("resets max_hr to 220 - age when the field is cleared (null)", () => {
    const u = buildProfileUpdate({ ...input, maxHr: null }, 150, now);
    expect(u.max_hr).toBe(computeProfileDerived(input, now).maxHr);
  });
  it("uses an explicit max_hr override over the existing one", () => {
    expect(buildProfileUpdate({ ...input, maxHr: 175 }, 188, now).max_hr).toBe(175);
  });
});

describe("height conversion", () => {
  it("converts ft/in to cm", () => {
    expect(ftInToCm(5, 9)).toBe(175.3);
    expect(ftInToCm(6, 0)).toBe(182.9);
  });
  it("converts cm to ft/in", () => {
    expect(cmToFtIn(175)).toEqual({ ft: 5, inch: 9 });
    expect(cmToFtIn(182.88)).toEqual({ ft: 6, inch: 0 });
  });
  it("rolls 12 inches over", () => {
    expect(cmToFtIn(182)).toEqual({ ft: 6, inch: 0 });
  });
});
