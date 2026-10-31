import type { DateRange, ReportActivity, ReportInputs, ReportMeal, ReportProfile, ReportWeight, ReportZones } from "@fittrack/shared";
import type { ProfileRow } from "./database.types";
import { supabase } from "./supabase";
import { addDaysIst, toUtcIso } from "./time";

/**
 * Loads everything the dashboard and reports need for a date range. Part of the Phase 3 contract (frozen).
 * Supabase returns at most 1000 rows per request, so every query is paged.
 */

const PAGE = 1000;

export interface PageResult<T> { data: T[] | null; error: { message: string } | null }

/** Fetch every page of a range-based query until a short page comes back. */
export async function fetchAllPages<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>, size = PAGE): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

/** Convert a stored profile into the report profile, or null when a required field is missing. */
export function toReportProfile(p: ProfileRow | null): ReportProfile | null {
  if (!p || !p.sex || !p.dob || !p.height_cm || !p.weight_kg || !p.target_weight_kg || !p.goal || !p.pace
    || p.daily_kcal_target == null || p.protein_target_g == null || p.carb_target_g == null || p.fat_target_g == null) return null;
  return {
    sex: p.sex, dob: p.dob, heightCm: p.height_cm, weightKg: p.weight_kg, targetWeightKg: p.target_weight_kg,
    goal: p.goal, pace: p.pace, bmiStandard: p.bmi_standard, dailyKcalTarget: p.daily_kcal_target,
    proteinTargetG: p.protein_target_g, carbTargetG: p.carb_target_g, fatTargetG: p.fat_target_g,
    exerciseAddbackPct: p.exercise_addback_pct,
  };
}

interface RawActivity extends Omit<ReportActivity, "zones"> {
  /** PostgREST returns a to-one embed as an object, but tolerate an array or null */
  activity_hr_zones: ReportZones | ReportZones[] | null;
}

export function mapActivity(r: RawActivity): ReportActivity {
  const { activity_hr_zones: z, ...rest } = r;
  const zones = Array.isArray(z) ? (z[0] ?? null) : (z ?? null);
  return { ...rest, zones };
}

const ACTIVITY_COLS =
  "id,start_time,activity_type_id,custom_name,name,source,duration_min,distance_km,avg_hr,max_hr,calories,calories_estimated,excluded," +
  "activity_hr_zones(zone1_s,zone2_s,zone3_s,zone4_s,zone5_s)";

export interface RangeData {
  meals: ReportMeal[];
  activities: ReportActivity[];
  weights: ReportWeight[];
  typeNames: Record<number, string>;
}

/** Everything for `range` (IST dates, inclusive). Weight logs and activity type names are always complete. */
export async function fetchRangeData(userId: string, range: DateRange): Promise<RangeData> {
  const startIso = toUtcIso(range.from, "00:00");
  const endIso = toUtcIso(addDaysIst(range.to, 1), "00:00");

  const [meals, acts, weights, types] = await Promise.all([
    fetchAllPages<ReportMeal>((a, b) =>
      supabase.from("meal_entries").select("date,meal_type,food_name,kcal,protein,carbs,fat")
        .eq("user_id", userId).gte("date", range.from).lte("date", range.to).order("date").range(a, b) as unknown as PromiseLike<PageResult<ReportMeal>>),
    fetchAllPages<RawActivity>((a, b) =>
      supabase.from("activities").select(ACTIVITY_COLS)
        .eq("user_id", userId).eq("excluded", false).gte("start_time", startIso).lt("start_time", endIso)
        .order("start_time").range(a, b) as unknown as PromiseLike<PageResult<RawActivity>>),
    fetchAllPages<ReportWeight>((a, b) =>
      supabase.from("weight_logs").select("date,weight_kg").eq("user_id", userId).order("date").range(a, b) as unknown as PromiseLike<PageResult<ReportWeight>>),
    supabase.from("activity_types").select("id,name"),
  ]);
  if (types.error) throw new Error(types.error.message);

  return {
    meals,
    activities: acts.map(mapActivity),
    weights,
    typeNames: Object.fromEntries((types.data ?? []).map((t: { id: number; name: string }) => [t.id, t.name])),
  };
}

/** Convenience: the full ReportInputs for a range. */
export async function loadReportInputs(userId: string, range: DateRange, today: string, profile: ReportProfile): Promise<ReportInputs> {
  return { range, today, profile, ...(await fetchRangeData(userId, range)) };
}
