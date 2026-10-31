import type {
  ActivityLevel,
  BmiCategory,
  BmiStandard,
  CalorieTarget,
  FoodUnit,
  Goal,
  Intensity,
  MacroTargets,
  Nutrition,
  Pace,
  ProfileDerived,
  ProfileInput,
  Sex,
} from "./types";

export const KCAL_PER_KG = 7700;

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Grams per unit when a food has no override. `piece` falls back to the food's serving_g. */
export const DEFAULT_UNIT_GRAMS: Record<Exclude<FoodUnit, "piece">, number> = {
  g: 1,
  ml: 1,
  tbsp: 15,
  cup: 240,
  katori: 150,
  plate: 250,
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return round1(weightKg / (m * m));
}

export function bmiCategory(value: number, standard: BmiStandard): BmiCategory {
  if (value < 18.5) return "underweight";
  if (standard === "asian") {
    if (value < 23) return "normal";
    if (value < 25) return "overweight";
    return "obese";
  }
  if (value < 25) return "normal";
  if (value < 30) return "overweight";
  return "obese";
}

export function healthyWeightRange(
  heightCm: number,
  standard: BmiStandard,
): { minKg: number; maxKg: number } {
  const m2 = (heightCm / 100) ** 2;
  const maxBmi = standard === "asian" ? 22.9 : 24.9;
  return { minKg: round1(18.5 * m2), maxKg: round1(maxBmi * m2) };
}

export function ageFromDob(dob: string, now: Date = new Date()): number {
  const [y, m, d] = dob.split("-").map(Number);
  let age = now.getFullYear() - y;
  const month = now.getMonth() + 1;
  if (month < m || (month === m && now.getDate() < d)) age -= 1;
  return age;
}

export function bmr(input: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
}): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears;
  return input.sex === "male" ? base + 5 : base - 161;
}

export function activityFactor(level: ActivityLevel): number {
  return ACTIVITY_FACTORS[level];
}

export function tdee(bmrValue: number, level: ActivityLevel): number {
  return bmrValue * activityFactor(level);
}

export function calorieTarget(input: {
  tdee: number;
  bmr: number;
  sex: Sex;
  goal: Goal;
  pace: Pace;
}): CalorieTarget {
  const floorKcal = Math.round(Math.max(input.bmr, input.sex === "female" ? 1200 : 1500));
  const delta = (input.pace * KCAL_PER_KG) / 7; // 0.25 -> 275, 0.5 -> 550
  if (input.goal === "lose") {
    const raw = input.tdee - delta;
    if (raw < floorKcal) return { kcal: floorKcal, floorKcal, floorApplied: true };
    return { kcal: Math.round(raw), floorKcal, floorApplied: false };
  }
  const raw = input.goal === "gain" ? input.tdee + delta : input.tdee;
  return { kcal: Math.round(raw), floorKcal, floorApplied: false };
}

export function macroTargets(input: { weightKg: number; kcal: number }): MacroTargets {
  const proteinG = Math.round(1.4 * input.weightKg);
  const fatG = Math.round((0.275 * input.kcal) / 9);
  const carbsG = Math.max(0, Math.round((input.kcal - proteinG * 4 - fatG * 9) / 4));
  return { proteinG, fatG, carbsG };
}

export function dayAllowance(
  targetKcal: number,
  exerciseKcal: number,
  addbackPct: number,
): number {
  return Math.round(targetKcal + (exerciseKcal * addbackPct) / 100);
}

export function metKcal(input: { met: number; weightKg: number; durationMin: number }): number {
  if (!(input.weightKg > 0)) throw new RangeError("weightKg must be positive");
  if (!(input.durationMin > 0)) throw new RangeError("durationMin must be positive");
  return Math.round((input.met * input.weightKg * input.durationMin) / 60);
}

export function metForIntensity(
  t: { met_light: number; met_moderate: number; met_vigorous: number },
  i: Intensity,
): number {
  return i === "light" ? t.met_light : i === "moderate" ? t.met_moderate : t.met_vigorous;
}

export function defaultMaxHr(ageYears: number): number {
  return 220 - ageYears;
}

export function hrZones(
  maxHr: number,
): Array<{ zone: 1 | 2 | 3 | 4 | 5; minBpm: number; maxBpm: number }> {
  const pcts = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const zones: Array<{ zone: 1 | 2 | 3 | 4 | 5; minBpm: number; maxBpm: number }> = [];
  let prevMax = 0;
  for (let i = 0; i < 5; i++) {
    const minBpm = i === 0 ? Math.ceil(maxHr * pcts[0]) : prevMax + 1;
    const maxBpm = Math.round(maxHr * pcts[i + 1]);
    zones.push({ zone: (i + 1) as 1 | 2 | 3 | 4 | 5, minBpm, maxBpm });
    prevMax = maxBpm;
  }
  return zones;
}

export function weeksToTarget(input: {
  weightKg: number;
  targetWeightKg: number;
  pace: Pace;
}): number {
  return Math.abs(input.weightKg - input.targetWeightKg) / input.pace;
}

export function targetDate(weeks: number, from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + Math.ceil(weeks * 7));
  return d;
}

export function kcalToKg(kcal: number): number {
  return kcal / KCAL_PER_KG;
}

export function gramsFor(
  quantity: number,
  unit: FoodUnit | "serving",
  food: { serving_g: number; unit_grams: Record<string, number> },
): number {
  if (!(quantity > 0)) throw new RangeError("quantity must be positive");
  let per: number;
  if (unit === "serving") per = food.serving_g;
  else if (food.unit_grams[unit] !== undefined) per = food.unit_grams[unit];
  else if (unit === "piece") per = food.serving_g;
  else per = DEFAULT_UNIT_GRAMS[unit];
  return round1(quantity * per);
}

export function scaleNutrition(per100g: Nutrition, grams: number): Nutrition {
  const f = grams / 100;
  const out: Nutrition = {
    kcal: Math.round(per100g.kcal * f),
    protein: round1(per100g.protein * f),
    carbs: round1(per100g.carbs * f),
    fat: round1(per100g.fat * f),
  };
  if (per100g.fibre !== undefined) out.fibre = round1(per100g.fibre * f);
  return out;
}

export function computeProfileDerived(p: ProfileInput, now: Date = new Date()): ProfileDerived {
  const ageYears = ageFromDob(p.dob, now);
  const bmiValue = bmi(p.weightKg, p.heightCm);
  const bmrValue = bmr({ sex: p.sex, weightKg: p.weightKg, heightCm: p.heightCm, ageYears });
  const tdeeValue = tdee(bmrValue, p.activityLevel);
  const target = calorieTarget({
    tdee: tdeeValue,
    bmr: bmrValue,
    sex: p.sex,
    goal: p.goal,
    pace: p.pace,
  });
  return {
    ageYears,
    bmi: bmiValue,
    bmiCategory: bmiCategory(bmiValue, p.bmiStandard),
    bmr: Math.round(bmrValue),
    tdee: Math.round(tdeeValue),
    dailyKcalTarget: target.kcal,
    floorApplied: target.floorApplied,
    macros: macroTargets({ weightKg: p.weightKg, kcal: target.kcal }),
    maxHr: defaultMaxHr(ageYears),
  };
}
