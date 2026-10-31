/** Service-role persistence for the weekly email. The only module here that talks to Supabase. */
import { createClient } from "@supabase/supabase-js";
import type { DateRange, ReportActivity, ReportMeal, ReportWeight, ReportZones } from "@fittrack/shared";

export interface EmailProfile {
  name: string | null;
  email_weekly: boolean;
  last_weekly_email_at: string | null;
  sex: "male" | "female" | null;
  dob: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  target_weight_kg: number | null;
  goal: string | null;
  pace: number | null;
  bmi_standard: string | null;
  daily_kcal_target: number | null;
  protein_target_g: number | null;
  carb_target_g: number | null;
  fat_target_g: number | null;
  exercise_addback_pct: number | null;
}

export interface WeekData {
  meals: ReportMeal[];
  activities: ReportActivity[];
  weights: ReportWeight[];
  typeNames: Record<number, string>;
}

export interface EmailStore {
  getProfile(userId: string): Promise<EmailProfile | null>;
  /** Range is IST dates, inclusive. */
  fetchWeekData(userId: string, range: DateRange): Promise<WeekData>;
  getUserEmail(userId: string): Promise<string | null>;
  /**
   * Atomically set last_weekly_email_at = nowIso when the user is opted in and (cutoffIso is null, or never mailed,
   * or last mailed before cutoffIso). Returns false when no row matched.
   */
  claimWeeklySend(userId: string, opts: { nowIso: string; cutoffIso: string | null }): Promise<boolean>;
  /** Restore previousIso, but only while the column still equals claimedIso (never clobbers a newer value). */
  rollbackWeeklySend(userId: string, opts: { claimedIso: string; previousIso: string | null }): Promise<void>;
  setEmailWeekly(userId: string, value: boolean): Promise<void>;
}

const PROFILE_COLS =
  "name,email_weekly,last_weekly_email_at,sex,dob,height_cm,weight_kg,target_weight_kg,goal,pace,bmi_standard," +
  "daily_kcal_target,protein_target_g,carb_target_g,fat_target_g,exercise_addback_pct";
const ACTIVITY_COLS =
  "id,start_time,activity_type_id,custom_name,name,source,duration_min,distance_km,avg_hr,max_hr,calories,calories_estimated,excluded," +
  "activity_hr_zones(zone1_s,zone2_s,zone3_s,zone4_s,zone5_s)";
const CAP = 5000;

interface RawActivity extends Omit<ReportActivity, "zones"> {
  activity_hr_zones: ReportZones | ReportZones[] | null;
}

/** UTC instant of 00:00 IST on the given IST date. */
export function istDayStartIso(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00+05:30`)).toISOString();
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Errors carry only a fixed label: database messages may contain row data. */
function fail(what: string): never {
  throw new Error(`${what} failed`);
}

export function createEmailStore(opts: { url: string; serviceRoleKey: string }): EmailStore {
  const db = createClient(opts.url, opts.serviceRoleKey, { auth: { persistSession: false } });
  return {
    async getProfile(userId) {
      const { data, error } = await db.from("profiles").select(PROFILE_COLS).eq("user_id", userId).maybeSingle();
      if (error) return fail("profile read");
      return (data as unknown as EmailProfile | null) ?? null;
    },
    async fetchWeekData(userId, range) {
      const startIso = istDayStartIso(range.from);
      const endIso = istDayStartIso(nextDay(range.to));
      const [meals, acts, weights, types] = await Promise.all([
        db.from("meal_entries").select("date,meal_type,food_name,kcal,protein,carbs,fat")
          .eq("user_id", userId).gte("date", range.from).lte("date", range.to).order("date").limit(CAP),
        db.from("activities").select(ACTIVITY_COLS)
          .eq("user_id", userId).eq("excluded", false).gte("start_time", startIso).lt("start_time", endIso)
          .order("start_time").limit(CAP),
        db.from("weight_logs").select("date,weight_kg").eq("user_id", userId).order("date").limit(CAP),
        db.from("activity_types").select("id,name"),
      ]);
      if (meals.error || acts.error || weights.error || types.error) return fail("report read");
      const activities = ((acts.data ?? []) as unknown as RawActivity[]).map((r): ReportActivity => {
        const { activity_hr_zones: z, ...rest } = r;
        return { ...rest, zones: Array.isArray(z) ? (z[0] ?? null) : (z ?? null) };
      });
      return {
        meals: (meals.data ?? []) as unknown as ReportMeal[],
        activities,
        weights: (weights.data ?? []) as unknown as ReportWeight[],
        typeNames: Object.fromEntries(
          ((types.data ?? []) as Array<{ id: number; name: string }>).map((t) => [t.id, t.name]),
        ),
      };
    },
    async getUserEmail(userId) {
      const { data, error } = await db.auth.admin.getUserById(userId);
      if (error) return null;
      return data.user?.email || null;
    },
    async claimWeeklySend(userId, { nowIso, cutoffIso }) {
      let q = db.from("profiles").update({ last_weekly_email_at: nowIso }).eq("user_id", userId).eq("email_weekly", true);
      if (cutoffIso) q = q.or(`last_weekly_email_at.is.null,last_weekly_email_at.lt.${cutoffIso}`);
      const { data, error } = await q.select("user_id");
      if (error) return fail("claim send");
      return (data ?? []).length > 0;
    },
    async rollbackWeeklySend(userId, { claimedIso, previousIso }) {
      const { error } = await db.from("profiles").update({ last_weekly_email_at: previousIso })
        .eq("user_id", userId).eq("last_weekly_email_at", claimedIso);
      if (error) fail("rollback send");
    },
    async setEmailWeekly(userId, value) {
      const { error } = await db.from("profiles").update({ email_weekly: value }).eq("user_id", userId);
      if (error) fail("unsubscribe");
    },
  };
}
