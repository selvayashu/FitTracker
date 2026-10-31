/** Shared domain types. This file is part of the Phase 1 contract: change only with orchestrator approval. */

export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type Goal = "lose" | "maintain" | "gain";
/** kg per week */
export type Pace = 0.25 | 0.5;
export type BmiStandard = "asian" | "who";
export type BmiCategory = "underweight" | "normal" | "overweight" | "obese";
export type Intensity = "light" | "moderate" | "vigorous";
export type MealType = "breakfast" | "lunch" | "snack" | "dinner";
export type ActivitySource = "strava" | "manual";
export type ActivityTrackingMode = "strava" | "manual";
export type FoodUnit = "g" | "ml" | "piece" | "katori" | "cup" | "plate" | "tbsp";

export interface Nutrition {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre?: number;
}

export interface MacroTargets {
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export interface CalorieTarget {
  /** Final daily target after the safety floor. */
  kcal: number;
  /** max(BMR, 1200 female / 1500 male) */
  floorKcal: number;
  /** True when the requested goal would have gone below the floor. */
  floorApplied: boolean;
}

export interface ProfileInput {
  sex: Sex;
  /** ISO date YYYY-MM-DD */
  dob: string;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  activityLevel: ActivityLevel;
  goal: Goal;
  pace: Pace;
  bmiStandard: BmiStandard;
}

export interface ProfileDerived {
  ageYears: number;
  bmi: number;
  bmiCategory: BmiCategory;
  bmr: number;
  tdee: number;
  dailyKcalTarget: number;
  floorApplied: boolean;
  macros: MacroTargets;
  maxHr: number;
}
