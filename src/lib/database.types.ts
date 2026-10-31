/**
 * Phase 1 database contract (hand-maintained). Migrations in supabase/migrations MUST match these shapes.
 * Timestamps are ISO strings in UTC; dates are YYYY-MM-DD.
 * Phase 2 adds: strava_connections, activity_hr_zones.
 */
import type {
  ActivityLevel, ActivitySource, ActivityTrackingMode, BmiStandard, Goal, Intensity, MealType, Sex,
} from "@fittrack/shared";

export interface ProfileRow {
  user_id: string;               // PK, FK auth.users
  name: string | null;
  sex: Sex | null;
  dob: string | null;
  height_cm: number | null;      // CHECK 100..250
  weight_kg: number | null;      // CHECK 20..400
  target_weight_kg: number | null;
  activity_level: ActivityLevel | null;
  goal: Goal | null;
  pace: 0.25 | 0.5 | null;
  bmi_standard: BmiStandard;     // default 'asian'
  activity_tracking_mode: ActivityTrackingMode; // default 'manual'
  exercise_addback_pct: number;  // default 50, CHECK 0..100
  max_hr: number | null;         // CHECK 100..230
  bmi: number | null;
  bmr: number | null;
  tdee: number | null;
  daily_kcal_target: number | null;
  protein_target_g: number | null;
  carb_target_g: number | null;
  fat_target_g: number | null;
  onboarded: boolean;            // default false
  created_at: string;
  updated_at: string;
}

export interface WeightLogRow {
  id: string;                    // client-generated uuid
  user_id: string;
  date: string;                  // UNIQUE (user_id, date)
  weight_kg: number;
  bmi: number | null;
  created_at: string;
}

export interface ActivityTypeRow {   // seeded, read-only for users
  id: number;
  name: string;
  met_light: number;
  met_moderate: number;
  met_vigorous: number;
  has_distance: boolean;
  sort_order: number;
}

export interface ActivityRow {
  id: string;                    // client-generated uuid
  user_id: string;
  source: ActivitySource;        // 'manual' in Phase 1
  strava_id: number | null;      // UNIQUE where not null
  activity_type_id: number;
  custom_name: string | null;
  start_time: string;            // timestamptz UTC
  duration_min: number;          // CHECK 1..600
  distance_km: number | null;
  steps: number | null;
  intensity: Intensity;
  avg_hr: number | null;         // CHECK 40..220
  max_hr: number | null;         // CHECK 40..220
  calories: number | null;
  calories_estimated: boolean;
  notes: string | null;
  duplicate_of: string | null;   // reserved for Phase 2
  created_at: string;
  updated_at: string;
}

export interface ActivityTemplateRow {
  id: string;
  user_id: string;
  name: string;
  activity_type_id: number;
  duration_min: number;
  intensity: Intensity;
  created_at: string;
}

export interface FoodRow {          // seeded, read-only for users
  id: number;
  name: string;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fibre_per_100g: number;
  serving_label: string;         // e.g. '1 katori'
  serving_g: number;
  /** grams per unit overrides, e.g. {"piece":40,"katori":150}; missing units fall back to shared defaults */
  unit_grams: Record<string, number>;
  category: string | null;
}

export interface CustomFoodRow {
  id: string;
  user_id: string;
  name: string;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fibre_per_100g: number;
  serving_label: string;
  serving_g: number;
  unit_grams: Record<string, number>;
  created_at: string;
}

export interface MealEntryRow {
  id: string;                    // client-generated uuid
  user_id: string;
  date: string;                  // IST calendar date of the meal
  meal_type: MealType;
  food_id: number | null;
  custom_food_id: string | null;
  external_ref: string | null;   // e.g. 'off:8901234567890' for Open Food Facts
  food_name: string;             // snapshot
  quantity: number;              // CHECK > 0
  unit: string;
  grams: number;                 // resolved grams
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  created_at: string;
}

export interface FavouriteMealRow {
  id: string;
  user_id: string;
  name: string;
  meal_type: MealType | null;
  items: Array<Pick<MealEntryRow, "food_id" | "custom_food_id" | "external_ref" | "food_name" | "quantity" | "unit" | "grams" | "kcal" | "protein" | "carbs" | "fat">>;
  created_at: string;
}

export interface DailySummaryRow {
  user_id: string;
  date: string;                  // PK (user_id, date)
  kcal_in: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  kcal_active: number;
  active_minutes: number;
  workouts: number;
  updated_at: string;
}
