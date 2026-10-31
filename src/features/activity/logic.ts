import { metForIntensity, metKcal, type Intensity } from "@fittrack/shared";
import type { ActivityRow, ActivityTemplateRow, ActivityTypeRow } from "@/lib/database.types";
import { istDateOf, istTimeOf, parseDuration, formatDuration, toUtcIso } from "@/lib/time";

export const OTHER_NAME = "Other";
export const MIN_DURATION = 1;
export const MAX_DURATION = 600;
export const MIN_HR = 40;
export const MAX_HR = 220;

/** Raw form state: everything is text, exactly as typed. */
export interface ActivityFormValues {
  typeId: number | null;
  customName: string;
  date: string;       // IST YYYY-MM-DD
  time: string;       // HH:mm IST
  duration: string;   // hh:mm
  intensity: Intensity;
  distance: string;
  steps: string;
  avgHr: string;
  maxHr: string;
  calories: string;
  notes: string;
}

export type ActivityPrefill = Partial<ActivityFormValues>;
export type FormErrors = Partial<Record<keyof ActivityFormValues, string>>;

export const isOther = (t: Pick<ActivityTypeRow, "name"> | undefined | null) => !!t && t.name === OTHER_NAME;

function num(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Validate the form. `today` is the IST date (YYYY-MM-DD) used for the "not in the future" rule. */
export function validateForm(v: ActivityFormValues, types: ActivityTypeRow[], today: string): FormErrors {
  const e: FormErrors = {};
  const type = types.find((t) => t.id === v.typeId);
  if (!type) e.typeId = "Choose an activity type.";
  if (type && isOther(type) && v.customName.trim() === "") e.customName = "Enter a name for this activity.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) e.date = "Choose a date.";
  else if (v.date > today) e.date = "Date cannot be in the future.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time)) e.time = "Enter a start time (HH:mm).";

  const dur = parseDuration(v.duration);
  if (v.duration.trim() === "") e.duration = "Duration is required (hh:mm).";
  else if (!/^\d{1,2}:[0-5]\d$/.test(v.duration.trim())) e.duration = "Use hh:mm, for example 00:45.";
  else if (dur < MIN_DURATION) e.duration = "Duration must be at least 1 minute.";
  else if (dur > MAX_DURATION) e.duration = "Duration cannot exceed 10 hours (600 minutes).";

  const dist = num(v.distance);
  if (dist !== null && (Number.isNaN(dist) || dist < 0)) e.distance = "Distance must be 0 or more.";
  const steps = num(v.steps);
  if (steps !== null && (Number.isNaN(steps) || steps < 0 || !Number.isInteger(steps))) e.steps = "Steps must be a whole number, 0 or more.";
  const cal = num(v.calories);
  if (cal !== null && (Number.isNaN(cal) || cal < 0)) e.calories = "Calories must be 0 or more.";

  const avg = num(v.avgHr);
  const max = num(v.maxHr);
  const hrBad = (n: number | null) => n !== null && (Number.isNaN(n) || !Number.isInteger(n) || n < MIN_HR || n > MAX_HR);
  if (hrBad(avg)) e.avgHr = `Average heart rate must be ${MIN_HR}-${MAX_HR}.`;
  if (hrBad(max)) e.maxHr = `Max heart rate must be ${MIN_HR}-${MAX_HR}.`;
  if (!e.avgHr && !e.maxHr && avg !== null && max !== null && avg > max) e.avgHr = "Average heart rate cannot be above max.";
  return e;
}

export const hasErrors = (e: FormErrors) => Object.keys(e).length > 0;

/** Estimated burn in kcal, or null when weight/duration/type are unavailable. */
export function estimateKcal(
  type: ActivityTypeRow | undefined, intensity: Intensity, weightKg: number | null | undefined, durationMin: number,
): number | null {
  if (!type || !weightKg || weightKg <= 0 || durationMin < MIN_DURATION) return null;
  return metKcal({ met: metForIntensity(type, intensity), weightKg, durationMin });
}

export type ActivityWrite = Omit<ActivityRow, "created_at" | "updated_at">;

export interface BuildCtx { id: string; userId: string; weightKg: number | null | undefined; source?: ActivityRow["source"]; stravaId?: number | null }

/** Build the DB row from valid form values. Returns null if the type is unknown. */
export function buildActivityRow(v: ActivityFormValues, types: ActivityTypeRow[], ctx: BuildCtx): ActivityWrite | null {
  const type = types.find((t) => t.id === v.typeId);
  if (!type) return null;
  const durationMin = parseDuration(v.duration);
  const entered = num(v.calories);
  const userCalories = entered !== null && !Number.isNaN(entered) ? entered : null;
  const estimate = userCalories === null ? estimateKcal(type, v.intensity, ctx.weightKg, durationMin) : null;
  const n = (s: string) => { const x = num(s); return x === null || Number.isNaN(x) ? null : x; };
  return {
    id: ctx.id,
    user_id: ctx.userId,
    source: ctx.source ?? "manual",
    strava_id: ctx.stravaId ?? null,
    activity_type_id: type.id,
    custom_name: isOther(type) ? v.customName.trim() : null,
    start_time: toUtcIso(v.date, v.time),
    duration_min: durationMin,
    distance_km: n(v.distance),
    steps: n(v.steps),
    intensity: v.intensity,
    avg_hr: n(v.avgHr),
    max_hr: n(v.maxHr),
    calories: userCalories ?? estimate,
    calories_estimated: userCalories === null && estimate !== null,
    notes: v.notes.trim() === "" ? null : v.notes.trim(),
    duplicate_of: null,
  };
}

export function emptyForm(now: Date = new Date()): ActivityFormValues {
  return {
    typeId: null, customName: "", date: istDateOf(now), time: istTimeOf(now.toISOString()), duration: "",
    intensity: "moderate", distance: "", steps: "", avgHr: "", maxHr: "", calories: "", notes: "",
  };
}

/** Form values for editing an existing row. Estimated calories are shown blank so they get re-estimated. */
export function rowToForm(r: ActivityRow): ActivityFormValues {
  const s = (n: number | null) => (n === null ? "" : String(n));
  return {
    typeId: r.activity_type_id, customName: r.custom_name ?? "", date: istDateOf(r.start_time), time: istTimeOf(r.start_time),
    duration: formatDuration(Math.round(r.duration_min)), intensity: r.intensity, distance: s(r.distance_km), steps: s(r.steps),
    avgHr: s(r.avg_hr), maxHr: s(r.max_hr), calories: r.calories_estimated ? "" : s(r.calories), notes: r.notes ?? "",
  };
}

/** "Repeat": a copy that starts now with a new id; Strava link and duplicate marker are dropped. */
export function cloneForRepeat(r: ActivityRow, ctx: { id: string; now: Date }): ActivityWrite {
  const iso = new Date(ctx.now.getTime() - ctx.now.getUTCSeconds() * 1000 - ctx.now.getUTCMilliseconds()).toISOString();
  return {
    id: ctx.id, user_id: r.user_id, source: "manual", strava_id: null, activity_type_id: r.activity_type_id,
    custom_name: r.custom_name, start_time: iso, duration_min: r.duration_min, distance_km: r.distance_km, steps: r.steps,
    intensity: r.intensity, avg_hr: r.avg_hr, max_hr: r.max_hr, calories: r.calories, calories_estimated: r.calories_estimated,
    notes: r.notes, duplicate_of: null,
  };
}

export function templateFromForm(
  v: ActivityFormValues, types: ActivityTypeRow[], ctx: { id: string; userId: string; name?: string },
): Omit<ActivityTemplateRow, "created_at"> | null {
  const type = types.find((t) => t.id === v.typeId);
  const duration = parseDuration(v.duration);
  if (!type || duration < MIN_DURATION || duration > MAX_DURATION) return null;
  const name = (ctx.name ?? (isOther(type) && v.customName.trim() ? v.customName.trim() : type.name)).trim();
  return { id: ctx.id, user_id: ctx.userId, name, activity_type_id: type.id, duration_min: duration, intensity: v.intensity };
}

export function templateFromRow(
  r: ActivityRow, types: ActivityTypeRow[], ctx: { id: string },
): Omit<ActivityTemplateRow, "created_at"> {
  const type = types.find((t) => t.id === r.activity_type_id);
  return {
    id: ctx.id, user_id: r.user_id, name: r.custom_name?.trim() || type?.name || "Activity",
    activity_type_id: r.activity_type_id, duration_min: r.duration_min, intensity: r.intensity,
  };
}

export function templateToPrefill(t: ActivityTemplateRow, now: Date = new Date()): ActivityPrefill {
  const base = emptyForm(now);
  return { typeId: t.activity_type_id, duration: formatDuration(Math.round(t.duration_min)), intensity: t.intensity, date: base.date, time: base.time };
}

export interface DayGroup { date: string; items: ActivityRow[] }

const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

/** Group by IST date, days newest first, activities within a day newest first. */
export function groupByIstDate(rows: ActivityRow[]): DayGroup[] {
  const map = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    const d = istDateOf(r.start_time);
    const list = map.get(d);
    if (list) list.push(r); else map.set(d, [r]);
  }
  return [...map.entries()]
    .sort((a, b) => desc(a[0], b[0]))
    .map(([date, items]) => ({ date, items: [...items].sort((a, b) => desc(a.start_time, b.start_time)) }));
}

export function daySummary(items: ActivityRow[]): { minutes: number; kcal: number; anyEstimated: boolean } {
  return {
    minutes: Math.round(items.reduce((s, r) => s + Number(r.duration_min), 0)),
    kcal: Math.round(items.reduce((s, r) => s + Number(r.calories ?? 0), 0)),
    anyEstimated: items.some((r) => r.calories_estimated && r.calories !== null),
  };
}

export function activityLabel(r: ActivityRow, types: ActivityTypeRow[]): string {
  const t = types.find((x) => x.id === r.activity_type_id);
  return r.custom_name?.trim() || t?.name || "Activity";
}
