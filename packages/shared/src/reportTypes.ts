/** Dashboard and report types. Part of the Phase 3 contract (frozen). All dates are IST calendar dates, YYYY-MM-DD. */
import type { BmiStandard, Goal, MealType, Pace, Sex } from "./types";

export type RangePreset = "day" | "week" | "month" | "custom";

export interface DateRange {
  /** inclusive */
  from: string;
  /** inclusive */
  to: string;
}

/** The profile fields the calculations need (taken from `profiles`; targets are the stored, already-floored values). */
export interface ReportProfile {
  sex: Sex;
  dob: string;
  heightCm: number;
  /** current weight, the fallback when no weight log exists on or before a day */
  weightKg: number;
  targetWeightKg: number;
  goal: Goal;
  pace: Pace;
  bmiStandard: BmiStandard;
  dailyKcalTarget: number;
  proteinTargetG: number;
  carbTargetG: number;
  fatTargetG: number;
  /** 0..100 */
  exerciseAddbackPct: number;
}

export interface ReportMeal {
  date: string;
  meal_type: MealType;
  food_name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface ReportZones {
  zone1_s: number;
  zone2_s: number;
  zone3_s: number;
  zone4_s: number;
  zone5_s: number;
}

export interface ReportActivity {
  id: string;
  /** ISO UTC */
  start_time: string;
  activity_type_id: number;
  custom_name: string | null;
  /** Strava activity name when present */
  name: string | null;
  source: "strava" | "manual";
  duration_min: number;
  distance_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  calories_estimated: boolean;
  /** hidden duplicates are ignored everywhere */
  excluded: boolean;
  zones: ReportZones | null;
}

export interface ReportWeight {
  date: string;
  weight_kg: number;
}

export interface ReportInputs {
  range: DateRange;
  /** IST today; days after it are never included */
  today: string;
  profile: ReportProfile;
  meals: ReportMeal[];
  activities: ReportActivity[];
  /** ALL weight logs (any date), used for the per-day BMR and progress */
  weights: ReportWeight[];
  /** activity_types id -> name */
  typeNames: Record<number, string>;
}

export interface DayRow {
  date: string;
  /** at least one meal entry exists; unlogged days are excluded from intake averages and on-target counts */
  logged: boolean;
  kcalIn: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  bySlot: Record<MealType, number>;
  activeKcal: number;
  /** portion of activeKcal that comes from MET estimates */
  activeKcalEstimated: number;
  activeMin: number;
  workouts: number;
  /** BMR using the weight in effect that day (latest log on or before the date, else the profile weight) */
  bmr: number;
  /** bmr + activeKcal (estimated) */
  kcalOut: number;
  /** kcalIn - kcalOut */
  net: number;
  /** dailyKcalTarget + addback% of activeKcal */
  allowance: number;
  /** allowance - kcalIn */
  remaining: number;
  /** logged && kcalIn <= allowance */
  onTarget: boolean;
}

export interface TypeBreakdown {
  name: string;
  count: number;
  minutes: number;
  kcal: number;
}

export interface RangeSummary {
  range: DateRange;
  days: DayRow[];
  totalDays: number;
  loggedDays: number;
  unloggedDays: number;
  onTargetDays: number;
  overTargetDays: number;
  /** all of the following "avg" and "net" figures use logged days only */
  avgKcalIn: number;
  avgKcalOut: number;
  avgNet: number;
  totalNet: number;
  /** totalNet / 7700, signed (negative = loss). An estimate. */
  estimatedWeightChangeKg: number;
  activity: {
    totalMinutes: number;
    totalHours: number;
    activeDays: number;
    workouts: number;
    distanceKm: number;
    activeKcal: number;
    /** 0..1 share of activeKcal that is a MET estimate */
    estimatedShare: number;
    byType: TypeBreakdown[];
    bySource: { strava: { count: number; minutes: number }; manual: { count: number; minutes: number } };
  };
  hr: {
    hasData: boolean;
    /** one point per day that has HR data */
    series: Array<{ date: string; avgHr: number | null; maxHr: number | null }>;
    overallAvg: number | null;
    overallMax: number | null;
    /** seconds in zones 1..5, summed over activities that have zone data */
    zoneSeconds: [number, number, number, number, number];
  };
  macros: {
    avgProteinG: number;
    avgCarbsG: number;
    avgFatG: number;
    targets: { proteinG: number; carbsG: number; fatG: number };
    /** avg as a percent of target, rounded */
    pctOfTarget: { protein: number; carbs: number; fat: number };
    /** percent of intake kcal from each macro (4/4/9), rounded, sums to ~100 */
    kcalSplitPct: { protein: number; carbs: number; fat: number };
  };
  slots: Array<{ slot: MealType; avgKcal: number; pct: number }>;
  topFoods: Array<{ name: string; kcal: number; count: number }>;
  weight: {
    series: Array<{ date: string; weightKg: number; bmi: number }>;
    startKg: number | null;
    latestKg: number | null;
    /** latest - start of the series inside the range (null when fewer than 2 points) */
    changeKg: number | null;
    /** 0..100 from the first log ever to the target; 100 when goal is maintain */
    progressPct: number | null;
  };
}

export interface TodaySnapshot {
  date: string;
  consumedKcal: number;
  targetKcal: number;
  addbackKcal: number;
  allowanceKcal: number;
  remainingKcal: number;
  over: boolean;
  burnedKcal: number;
  bmr: number;
  activeKcal: number;
  netKcal: number;
  activeMinutes: number;
  workouts: number;
  avgHr: number | null;
  macros: { proteinG: number; carbsG: number; fatG: number };
  macroTargets: { proteinG: number; carbsG: number; fatG: number };
  slotKcal: Record<MealType, number>;
}
