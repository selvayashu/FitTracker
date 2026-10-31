import { describe, expect, it } from "vitest";
import * as S from "./index";

describe("bmi", () => {
  it("computes to 1 decimal", () => {
    expect(S.bmi(70, 175)).toBe(22.9);
    expect(S.bmi(80, 180)).toBe(24.7);
  });
});

describe("bmiCategory", () => {
  it("asian edges", () => {
    expect(S.bmiCategory(18.4, "asian")).toBe("underweight");
    expect(S.bmiCategory(18.5, "asian")).toBe("normal");
    expect(S.bmiCategory(22.9, "asian")).toBe("normal");
    expect(S.bmiCategory(23.0, "asian")).toBe("overweight");
    expect(S.bmiCategory(24.9, "asian")).toBe("overweight");
    expect(S.bmiCategory(25.0, "asian")).toBe("obese");
  });
  it("who edges", () => {
    expect(S.bmiCategory(18.4, "who")).toBe("underweight");
    expect(S.bmiCategory(18.5, "who")).toBe("normal");
    expect(S.bmiCategory(24.9, "who")).toBe("normal");
    expect(S.bmiCategory(25.0, "who")).toBe("overweight");
    expect(S.bmiCategory(29.9, "who")).toBe("overweight");
    expect(S.bmiCategory(30.0, "who")).toBe("obese");
  });
});

describe("healthyWeightRange", () => {
  it("asian 170cm", () => {
    // 1.7^2 = 2.89; 18.5*2.89 = 53.465 -> 53.5; 22.9*2.89 = 66.181 -> 66.2
    expect(S.healthyWeightRange(170, "asian")).toEqual({ minKg: 53.5, maxKg: 66.2 });
  });
  it("who 170cm", () => {
    // 24.9*2.89 = 71.961 -> 72
    expect(S.healthyWeightRange(170, "who")).toEqual({ minKg: 53.5, maxKg: 72 });
  });
});

describe("bmr", () => {
  it("male", () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    expect(S.bmr({ sex: "male", weightKg: 80, heightCm: 180, ageYears: 30 })).toBe(1780);
  });
  it("female", () => {
    // 600 + 1031.25 - 140 - 161 = 1330.25
    expect(S.bmr({ sex: "female", weightKg: 60, heightCm: 165, ageYears: 28 })).toBeCloseTo(1330.25, 6);
  });
});

describe("activity factors and tdee", () => {
  it.each([
    ["sedentary", 1.2],
    ["light", 1.375],
    ["moderate", 1.55],
    ["active", 1.725],
    ["very_active", 1.9],
  ] as const)("%s", (level, f) => {
    expect(S.activityFactor(level)).toBe(f);
    expect(S.tdee(2000, level)).toBeCloseTo(2000 * f, 6);
  });
});

describe("calorieTarget", () => {
  const base = { tdee: 2400, bmr: 1700, sex: "male" as const };
  it("all six goal/pace combos", () => {
    expect(S.calorieTarget({ ...base, goal: "lose", pace: 0.25 }).kcal).toBe(2125);
    expect(S.calorieTarget({ ...base, goal: "lose", pace: 0.5 }).kcal).toBe(1850);
    expect(S.calorieTarget({ ...base, goal: "maintain", pace: 0.25 }).kcal).toBe(2400);
    expect(S.calorieTarget({ ...base, goal: "maintain", pace: 0.5 }).kcal).toBe(2400);
    expect(S.calorieTarget({ ...base, goal: "gain", pace: 0.25 }).kcal).toBe(2675);
    expect(S.calorieTarget({ ...base, goal: "gain", pace: 0.5 }).kcal).toBe(2950);
  });
  it("female floor 1200 applied", () => {
    const r = S.calorieTarget({ tdee: 1600, bmr: 1100, sex: "female", goal: "lose", pace: 0.5 });
    expect(r).toEqual({ kcal: 1200, floorKcal: 1200, floorApplied: true });
  });
  it("male floor 1500 applied", () => {
    const r = S.calorieTarget({ tdee: 1900, bmr: 1400, sex: "male", goal: "lose", pace: 0.5 });
    expect(r).toEqual({ kcal: 1500, floorKcal: 1500, floorApplied: true });
  });
  it("BMR is the floor when above 1200/1500", () => {
    const f = S.calorieTarget({ tdee: 1700, bmr: 1400, sex: "female", goal: "lose", pace: 0.5 });
    expect(f).toEqual({ kcal: 1400, floorKcal: 1400, floorApplied: true });
    const m = S.calorieTarget({ tdee: 2000, bmr: 1800, sex: "male", goal: "lose", pace: 0.5 });
    expect(m).toEqual({ kcal: 1800, floorKcal: 1800, floorApplied: true });
  });
  it("floor not applied when raw target equals the floor", () => {
    const r = S.calorieTarget({ tdee: 1750, bmr: 1000, sex: "female", goal: "lose", pace: 0.5 });
    expect(r.floorApplied).toBe(false);
    expect(r.kcal).toBe(1200);
  });
  it("never reduces maintain or gain", () => {
    const m = S.calorieTarget({ tdee: 1000, bmr: 900, sex: "male", goal: "maintain", pace: 0.5 });
    expect(m).toEqual({ kcal: 1000, floorKcal: 1500, floorApplied: false });
    const g = S.calorieTarget({ tdee: 1000, bmr: 900, sex: "female", goal: "gain", pace: 0.25 });
    expect(g.kcal).toBe(1275);
    expect(g.floorApplied).toBe(false);
  });
});

describe("macroTargets", () => {
  it("worked example", () => {
    // protein 1.4*70 = 98 g; fat 0.275*2000/9 = 61.1 -> 61 g; carbs (2000-392-549)/4 = 264.75 -> 265
    expect(S.macroTargets({ weightKg: 70, kcal: 2000 })).toEqual({ proteinG: 98, fatG: 61, carbsG: 265 });
  });
  it("sums to within 4 kcal of target", () => {
    for (const kcal of [1200, 1337, 1500, 1800, 2111, 2500, 3003]) {
      for (const w of [45, 61.3, 70, 88.8, 120]) {
        const m = S.macroTargets({ weightKg: w, kcal });
        const total = m.proteinG * 4 + m.fatG * 9 + m.carbsG * 4;
        expect(Math.abs(total - kcal)).toBeLessThanOrEqual(4);
      }
    }
  });
  it("carbs never negative", () => {
    expect(S.macroTargets({ weightKg: 200, kcal: 500 }).carbsG).toBe(0);
  });
});

describe("dayAllowance", () => {
  it("adds back percentage", () => {
    expect(S.dayAllowance(1800, 400, 50)).toBe(2000);
    expect(S.dayAllowance(1800, 333, 50)).toBe(1967);
    expect(S.dayAllowance(1800, 400, 0)).toBe(1800);
  });
});

describe("metKcal", () => {
  it("known values", () => {
    expect(S.metKcal({ met: 8, weightKg: 70, durationMin: 30 })).toBe(280);
    expect(S.metKcal({ met: 3.5, weightKg: 60, durationMin: 45 })).toBe(158); // 157.5
    expect(S.metKcal({ met: 6, weightKg: 80, durationMin: 60 })).toBe(480);
  });
  it("throws RangeError", () => {
    expect(() => S.metKcal({ met: 5, weightKg: 0, durationMin: 30 })).toThrow(RangeError);
    expect(() => S.metKcal({ met: 5, weightKg: -1, durationMin: 30 })).toThrow(RangeError);
    expect(() => S.metKcal({ met: 5, weightKg: 70, durationMin: 0 })).toThrow(RangeError);
    expect(() => S.metKcal({ met: 5, weightKg: 70, durationMin: -5 })).toThrow(RangeError);
  });
});

describe("metForIntensity / defaultMaxHr", () => {
  const t = { met_light: 3, met_moderate: 5, met_vigorous: 8 };
  it("picks the right MET", () => {
    expect(S.metForIntensity(t, "light")).toBe(3);
    expect(S.metForIntensity(t, "moderate")).toBe(5);
    expect(S.metForIntensity(t, "vigorous")).toBe(8);
  });
  it("220 - age", () => expect(S.defaultMaxHr(30)).toBe(190));
});

describe("hrZones", () => {
  it("maxHr 190", () => {
    expect(S.hrZones(190)).toEqual([
      { zone: 1, minBpm: 95, maxBpm: 114 },
      { zone: 2, minBpm: 115, maxBpm: 133 },
      { zone: 3, minBpm: 134, maxBpm: 152 },
      { zone: 4, minBpm: 153, maxBpm: 171 },
      { zone: 5, minBpm: 172, maxBpm: 190 },
    ]);
  });
  it("contiguous for many maxHr values", () => {
    for (let max = 150; max <= 220; max++) {
      const z = S.hrZones(max);
      expect(z).toHaveLength(5);
      expect(z[0].minBpm).toBe(Math.ceil(max * 0.5));
      expect(z[4].maxBpm).toBe(max);
      for (let i = 1; i < 5; i++) expect(z[i].minBpm).toBe(z[i - 1].maxBpm + 1);
      for (const x of z) expect(x.maxBpm).toBeGreaterThanOrEqual(x.minBpm);
    }
  });
});

describe("weeksToTarget / targetDate / kcalToKg", () => {
  it("weeks", () => {
    expect(S.weeksToTarget({ weightKg: 80, targetWeightKg: 70, pace: 0.5 })).toBe(20);
    expect(S.weeksToTarget({ weightKg: 60, targetWeightKg: 65, pace: 0.25 })).toBe(20);
    expect(S.weeksToTarget({ weightKg: 70, targetWeightKg: 70, pace: 0.5 })).toBe(0);
  });
  it("targetDate adds whole days", () => {
    const from = new Date(2026, 0, 1);
    expect(S.targetDate(2, from)).toEqual(new Date(2026, 0, 15));
    expect(S.targetDate(0, from)).toEqual(from);
    expect(S.targetDate(1.1, from)).toEqual(new Date(2026, 0, 9)); // ceil(7.7) = 8
    expect(from).toEqual(new Date(2026, 0, 1)); // not mutated
  });
  it("kcalToKg", () => expect(S.kcalToKg(7700)).toBe(1));
});

describe("ageFromDob", () => {
  it("birthday eve / day", () => {
    expect(S.ageFromDob("2000-06-15", new Date(2026, 5, 14))).toBe(25);
    expect(S.ageFromDob("2000-06-15", new Date(2026, 5, 15))).toBe(26);
    expect(S.ageFromDob("2000-06-15", new Date(2026, 5, 16))).toBe(26);
    expect(S.ageFromDob("2000-06-15", new Date(2026, 0, 1))).toBe(25);
  });
  it("leap day", () => {
    expect(S.ageFromDob("2000-02-29", new Date(2025, 1, 28))).toBe(24);
    expect(S.ageFromDob("2000-02-29", new Date(2025, 2, 1))).toBe(25);
    expect(S.ageFromDob("2000-02-29", new Date(2024, 1, 29))).toBe(24);
    expect(S.ageFromDob("2000-02-29", new Date(2024, 1, 28))).toBe(23);
  });
});

describe("gramsFor", () => {
  const food = { serving_g: 120, unit_grams: {} as Record<string, number> };
  it("defaults", () => {
    expect(S.gramsFor(50, "g", food)).toBe(50);
    expect(S.gramsFor(200, "ml", food)).toBe(200);
    expect(S.gramsFor(2, "tbsp", food)).toBe(30);
    expect(S.gramsFor(1.5, "cup", food)).toBe(360);
    expect(S.gramsFor(2, "katori", food)).toBe(300);
    expect(S.gramsFor(0.5, "plate", food)).toBe(125);
    expect(S.gramsFor(3, "piece", food)).toBe(360);
    expect(S.gramsFor(2, "serving", food)).toBe(240);
  });
  it("overrides", () => {
    const f = { serving_g: 100, unit_grams: { katori: 180, piece: 45 } };
    expect(S.gramsFor(1, "katori", f)).toBe(180);
    expect(S.gramsFor(2, "piece", f)).toBe(90);
    expect(S.gramsFor(1, "cup", f)).toBe(240);
  });
  it("rounds to 1 decimal", () => {
    expect(S.gramsFor(0.333, "katori", food)).toBe(50);
    expect(S.gramsFor(1.37, "piece", { serving_g: 33, unit_grams: {} })).toBe(45.2);
  });
  it("throws on bad quantity", () => {
    expect(() => S.gramsFor(0, "g", food)).toThrow(RangeError);
    expect(() => S.gramsFor(-1, "g", food)).toThrow(RangeError);
  });
});

describe("scaleNutrition", () => {
  it("rounds and omits fibre when absent", () => {
    const r = S.scaleNutrition({ kcal: 130, protein: 2.7, carbs: 28.2, fat: 0.3 }, 150);
    expect(r.kcal).toBe(195);
    expect(r.carbs).toBe(42.3);
    expect(r.fibre).toBeUndefined();
    expect("fibre" in r).toBe(false);
  });
  it("kcal integer, fibre when provided", () => {
    // factor 0.33: kcal 32.67 -> 33, protein 3.3, carbs 6.6, fat 1.65 -> ~1.7, fibre 1.089 -> 1.1
    const r = S.scaleNutrition({ kcal: 99, protein: 10, carbs: 20, fat: 5, fibre: 3.3 }, 33);
    expect(r.kcal).toBe(33);
    expect(Number.isInteger(r.kcal)).toBe(true);
    expect(r.protein).toBe(3.3);
    expect(r.carbs).toBe(6.6);
    expect(r.fat).toBeCloseTo(1.7, 1);
    expect(r.fibre).toBe(1.1);
  });
  it("zero grams", () => {
    expect(S.scaleNutrition({ kcal: 100, protein: 1, carbs: 1, fat: 1 }, 0).kcal).toBe(0);
  });
});

describe("computeProfileDerived", () => {
  it("worked example: male, 80kg, 180cm, dob 1996-03-10, moderate, lose 0.5", () => {
    // now = 2026-10-31 -> age 30 (birthday passed in March)
    // bmi = 80 / 1.8^2 = 24.69 -> 24.7 ; asian -> overweight (23.0-24.9)
    // bmr = 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    // tdee = 1780 * 1.55 = 2759
    // target = 2759 - 550 = 2209 (floor = max(1780, 1500) = 1780, not applied)
    // protein = 1.4*80 = 112 g; fat = 0.275*2209/9 = 67.5 -> 67 g (67.497)
    // carbs = (2209 - 448 - 603)/4 = 289.5 -> 290
    // maxHr = 220 - 30 = 190
    const r = S.computeProfileDerived(
      {
        sex: "male", dob: "1996-03-10", heightCm: 180, weightKg: 80, targetWeightKg: 72,
        activityLevel: "moderate", goal: "lose", pace: 0.5, bmiStandard: "asian",
      },
      new Date(2026, 9, 31),
    );
    expect(r).toEqual({
      ageYears: 30, bmi: 24.7, bmiCategory: "overweight", bmr: 1780, tdee: 2759,
      dailyKcalTarget: 2209, floorApplied: false,
      macros: { proteinG: 112, fatG: 67, carbsG: 290 }, maxHr: 190,
    });
  });
  it("floor case uses final target for macros", () => {
    // female 50kg 155cm age 40: bmr = 500 + 968.75 - 200 - 161 = 1107.75 -> 1108
    // sedentary tdee = 1107.75*1.2 = 1329.3 -> 1329; lose 0.5 -> 779.3 < floor 1200 -> 1200
    // protein 70; fat 0.275*1200/9 = 36.7 -> 37; carbs (1200-280-333)/4 = 146.75 -> 147
    const r = S.computeProfileDerived(
      {
        sex: "female", dob: "1986-01-01", heightCm: 155, weightKg: 50, targetWeightKg: 48,
        activityLevel: "sedentary", goal: "lose", pace: 0.5, bmiStandard: "who",
      },
      new Date(2026, 5, 1),
    );
    expect(r.ageYears).toBe(40);
    expect(r.bmr).toBe(1108);
    expect(r.tdee).toBe(1329);
    expect(r.dailyKcalTarget).toBe(1200);
    expect(r.floorApplied).toBe(true);
    expect(r.macros).toEqual({ proteinG: 70, fatG: 37, carbsG: 147 });
    expect(r.bmiCategory).toBe("normal");
  });
});
