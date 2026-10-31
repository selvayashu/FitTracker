import { computeProfileDerived, type ActivityTrackingMode, type ProfileDerived, type ProfileInput } from "@fittrack/shared";
import type { ProfileRow } from "@/lib/database.types";

const CM_PER_IN = 2.54;

/** Feet + inches to centimetres, rounded to 1 decimal. */
export function ftInToCm(ft: number, inch: number): number {
  return Math.round((ft * 12 + inch) * CM_PER_IN * 10) / 10;
}

/** Centimetres to whole feet and inches (inches rounded; 12 in rolls over to the next foot). */
export function cmToFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = Math.round(cm / CM_PER_IN);
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 };
}

/** Columns that are computed from the profile inputs. */
export type DerivedColumns = Pick<
  ProfileRow,
  "bmi" | "bmr" | "tdee" | "daily_kcal_target" | "protein_target_g" | "carb_target_g" | "fat_target_g" | "max_hr"
>;

export interface ProfileSaveInput extends ProfileInput {
  name?: string | null;
  activityTrackingMode?: ActivityTrackingMode;
  exerciseAddbackPct?: number;
  /** User-chosen max HR. When omitted the existing value is kept, else 220 - age. */
  maxHr?: number | null;
}

export function derivedToColumns(derived: ProfileDerived, maxHr: number): DerivedColumns {
  return {
    bmi: derived.bmi,
    bmr: derived.bmr,
    tdee: derived.tdee,
    daily_kcal_target: derived.dailyKcalTarget,
    protein_target_g: derived.macros.proteinG,
    carb_target_g: derived.macros.carbsG,
    fat_target_g: derived.macros.fatG,
    max_hr: maxHr,
  };
}

/** Derived columns only (used when just the weight changes). max_hr is kept when already set. */
export function buildDerivedColumns(input: ProfileInput, existingMaxHr: number | null, now?: Date): DerivedColumns {
  const derived = computeProfileDerived(input, now);
  return derivedToColumns(derived, existingMaxHr ?? derived.maxHr);
}

/** All columns written when the user saves the profile form. Single source of truth for onboarding and settings. */
export function buildProfileUpdate(input: ProfileSaveInput, existingMaxHr: number | null, now?: Date) {
  const derived = computeProfileDerived(input, now);
  // null means the user cleared the field, so go back to the default (220 - age); undefined means "not provided".
  const maxHr = input.maxHr === null ? derived.maxHr : (input.maxHr ?? existingMaxHr ?? derived.maxHr);
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    sex: input.sex,
    dob: input.dob,
    height_cm: input.heightCm,
    weight_kg: input.weightKg,
    target_weight_kg: input.targetWeightKg,
    activity_level: input.activityLevel,
    goal: input.goal,
    pace: input.pace,
    bmi_standard: input.bmiStandard,
    ...(input.activityTrackingMode ? { activity_tracking_mode: input.activityTrackingMode } : {}),
    ...(input.exerciseAddbackPct !== undefined ? { exercise_addback_pct: input.exerciseAddbackPct } : {}),
    ...derivedToColumns(derived, maxHr),
    onboarded: true,
  };
}
