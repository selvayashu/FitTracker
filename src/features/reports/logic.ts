import type { DateRange, DayRow, RangePreset, RangeSummary } from "@fittrack/shared";

/** Pure helpers for the Reports page: chart shaping, formatting, text summaries. No React; all maths comes from @fittrack/shared. */

/** Finite numbers pass through; NaN, Infinity and non-numbers become 0. */
export function safe(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function fmtInt(n: number | null | undefined): string {
  return Math.round(safe(n)).toLocaleString("en-IN");
}

export function fmtSigned(n: number | null | undefined): string {
  const v = Math.round(safe(n));
  return `${v > 0 ? "+" : ""}${v.toLocaleString("en-IN")}`;
}

export function fmtKg(n: number | null | undefined, digits = 1): string {
  return `${safe(n).toFixed(digits)} kg`;
}

export function fmtSignedKg(n: number | null | undefined, digits = 2): string {
  const v = safe(n);
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)} kg`;
}

export function fmtHours(h: number | null | undefined): string {
  return `${safe(h).toFixed(1)} h`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "31 Oct" from YYYY-MM-DD (pure string handling, no timezone involved). */
export function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const mon = MONTHS[Number(m[2]) - 1];
  return mon ? `${Number(m[3])} ${mon}` : date;
}

/** "31 Oct 2026" */
export function longDate(date: string): string {
  const m = /^(\d{4})/.exec(date);
  return m ? `${shortDate(date)} ${m[1]}` : date;
}

/** IST range label: "31 Oct 2026" for one day, otherwise "25 Oct to 31 Oct 2026" (years shown when they differ). */
export function rangeLabel(range: DateRange): string {
  if (range.from === range.to) return longDate(range.from);
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${sameYear ? shortDate(range.from) : longDate(range.from)} to ${longDate(range.to)}`;
}

export const PRESET_LABEL: Record<RangePreset, string> = { day: "Day", week: "Week", month: "Month", custom: "Custom" };

/**
 * Recharts `interval` value (number of ticks to skip between labels) so that about `maxLabels` labels show.
 * With the default of 7: 7 points -> 0 (all), 30 -> 4, 366 -> 52.
 */
export function tickInterval(count: number, maxLabels = 7): number {
  const n = Math.floor(safe(count));
  const m = Math.max(1, Math.floor(safe(maxLabels)));
  if (n <= m) return 0;
  return Math.ceil(n / m) - 1;
}

export const dayLabel = shortDate;

export const SLOT_LABEL = { breakfast: "Breakfast", lunch: "Lunch", snack: "Evening snack", dinner: "Dinner" } as const;

export interface CalorieDatum {
  date: string;
  label: string;
  logged: boolean;
  /** null on unlogged days (never 0) */
  kcalIn: number | null;
  kcalOut: number;
  /** null on unlogged days */
  net: number | null;
  /** hatched placeholder bar height for unlogged days, else null */
  notLogged: number | null;
}

/** Shape day rows for the in/out bars and the net line. Unlogged days get a null intake and a placeholder marker instead of a zero bar. */
export function calorieChartData(days: DayRow[]): CalorieDatum[] {
  const maxOut = Math.max(0, ...days.map((d) => safe(d.kcalOut)));
  const placeholder = Math.max(1, Math.round(maxOut * 0.15));
  return days.map((d) => ({
    date: d.date,
    label: dayLabel(d.date),
    logged: d.logged,
    kcalIn: d.logged ? Math.round(safe(d.kcalIn)) : null,
    kcalOut: Math.round(safe(d.kcalOut)),
    net: d.logged ? Math.round(safe(d.net)) : null,
    notLogged: d.logged ? null : placeholder,
  }));
}

export function calorieSummaryText(s: RangeSummary): string {
  if (s.loggedDays === 0) return "No meals logged in this range.";
  const unl = s.unloggedDays > 0 ? ` (${plural(s.unloggedDays, "day")} not logged)` : "";
  return `Average ${fmtInt(s.avgKcalIn)} kcal in, ${fmtInt(s.avgKcalOut)} kcal out (estimated) over ${plural(s.loggedDays, "logged day")}${unl}.`;
}

export function netSummaryText(s: RangeSummary): string {
  if (s.loggedDays === 0) return "No net balance without logged meals.";
  const dir = s.avgNet < 0 ? "deficit" : s.avgNet > 0 ? "surplus" : "balanced";
  return `Average net ${fmtSigned(s.avgNet)} kcal per logged day (${dir}, estimated).`;
}

export function slotSummaryText(s: RangeSummary): string {
  const top = [...s.slots].sort((a, b) => safe(b.avgKcal) - safe(a.avgKcal))[0];
  if (!top || safe(top.avgKcal) <= 0) return "No meals logged in this range.";
  return `${SLOT_LABEL[top.slot]} is the largest meal at ${fmtInt(top.avgKcal)} kcal on average (${Math.round(safe(top.pct))}% of intake).`;
}

export interface MacroDatum { name: string; avg: number; target: number; pct: number }

export function macroData(s: RangeSummary): MacroDatum[] {
  const m = s.macros;
  return [
    { name: "Protein", avg: Math.round(safe(m.avgProteinG)), target: Math.round(safe(m.targets.proteinG)), pct: Math.round(safe(m.pctOfTarget.protein)) },
    { name: "Carbs", avg: Math.round(safe(m.avgCarbsG)), target: Math.round(safe(m.targets.carbsG)), pct: Math.round(safe(m.pctOfTarget.carbs)) },
    { name: "Fat", avg: Math.round(safe(m.avgFatG)), target: Math.round(safe(m.targets.fatG)), pct: Math.round(safe(m.pctOfTarget.fat)) },
  ];
}

export function macroSummaryText(s: RangeSummary): string {
  if (s.loggedDays === 0) return "No macros without logged meals.";
  return `${macroData(s).map((d) => `${d.name} ${d.avg} g of ${d.target} g (${d.pct}%)`).join(", ")} per day on average.`;
}

export function splitData(s: RangeSummary): Array<{ name: string; value: number }> {
  const p = s.macros.kcalSplitPct;
  return [
    { name: "Protein", value: Math.max(0, safe(p.protein)) },
    { name: "Carbs", value: Math.max(0, safe(p.carbs)) },
    { name: "Fat", value: Math.max(0, safe(p.fat)) },
  ];
}

export function splitSummaryText(s: RangeSummary): string {
  const d = splitData(s);
  if (d.every((x) => x.value === 0)) return "No macro split without logged meals.";
  return `Calories from ${d.map((x) => `${x.name.toLowerCase()} ${Math.round(x.value)}%`).join(", ")}.`;
}

export interface WeightDatum { date: string; label: string; weightKg: number; bmi: number }

export function weightData(s: RangeSummary): WeightDatum[] {
  return s.weight.series.map((p) => ({ date: p.date, label: dayLabel(p.date), weightKg: safe(p.weightKg), bmi: safe(p.bmi) }));
}

export function weightSummaryText(s: RangeSummary): string {
  const w = s.weight;
  if (w.series.length === 0) return "No weight logged in this range.";
  if (w.changeKg == null) return `One weight logged: ${fmtKg(w.latestKg)}.`;
  return `Weight ${fmtKg(w.startKg)} to ${fmtKg(w.latestKg)}, a change of ${fmtSignedKg(w.changeKg, 1)}.`;
}

export interface TypeDatum { name: string; count: number; minutes: number; kcal: number }

export function typeData(s: RangeSummary): TypeDatum[] {
  return s.activity.byType
    .map((t) => ({ name: t.name, count: safe(t.count), minutes: Math.round(safe(t.minutes)), kcal: Math.round(safe(t.kcal)) }))
    .sort((a, b) => b.minutes - a.minutes);
}

export function typeSummaryText(s: RangeSummary): string {
  const a = s.activity;
  if (a.workouts === 0) return "No activities in this range.";
  return `${plural(a.workouts, "activity", "activities")}, ${fmtHours(a.totalHours)} in total across ${plural(a.activeDays, "active day")}.`;
}

export function sourceData(s: RangeSummary): Array<{ name: string; count: number; minutes: number }> {
  const b = s.activity.bySource;
  return [
    { name: "Strava", count: safe(b.strava.count), minutes: Math.round(safe(b.strava.minutes)) },
    { name: "Manual", count: safe(b.manual.count), minutes: Math.round(safe(b.manual.minutes)) },
  ];
}

export function sourceSummaryText(s: RangeSummary): string {
  const [st, ma] = sourceData(s);
  if (!st || !ma || st.count + ma.count === 0) return "No activities in this range.";
  return `${plural(st.count, "activity", "activities")} from Strava, ${plural(ma.count, "activity", "activities")} entered manually.`;
}

export interface HrDatum { date: string; label: string; avgHr: number | null; maxHr: number | null }

export function hrData(s: RangeSummary): HrDatum[] {
  const fin = (n: number | null) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);
  return s.hr.series.map((p) => ({ date: p.date, label: dayLabel(p.date), avgHr: fin(p.avgHr), maxHr: fin(p.maxHr) }));
}

export function hrSummaryText(s: RangeSummary): string {
  if (!s.hr.hasData) return "No heart-rate data in this range.";
  const avg = s.hr.overallAvg == null ? "n/a" : `${fmtInt(s.hr.overallAvg)} bpm`;
  const max = s.hr.overallMax == null ? "n/a" : `${fmtInt(s.hr.overallMax)} bpm`;
  return `Average ${avg}, highest ${max}.`;
}

export interface ZoneDatum { name: string; minutes: number; pct: number }

export function zoneData(s: RangeSummary): ZoneDatum[] {
  const secs = s.hr.zoneSeconds.map((x) => Math.max(0, safe(x)));
  const total = secs.reduce((a, b) => a + b, 0);
  return secs.map((x, i) => ({ name: `Zone ${i + 1}`, minutes: Math.round(x / 60), pct: total > 0 ? Math.round((x / total) * 100) : 0 }));
}

export function zoneSummaryText(s: RangeSummary): string {
  const z = zoneData(s);
  if (z.every((d) => d.minutes === 0)) return "No heart-rate zone data in this range.";
  const top = z.reduce((a, b) => (b.minutes > a.minutes ? b : a));
  return `Most time in ${top.name}: ${plural(top.minutes, "minute")} (${top.pct}%).`;
}

export function weightChangeText(s: RangeSummary): string {
  if (s.loggedDays === 0) return "Not available without logged meals.";
  const kg = safe(s.estimatedWeightChangeKg);
  if (Math.abs(kg) < 0.005) return "About 0.00 kg (estimated)";
  return `${fmtSignedKg(kg)} (estimated, ${kg < 0 ? "loss" : "gain"})`;
}

/** Stale-response guard: only the result of the most recently started request may be applied. */
export interface RequestGuard {
  next: () => number;
  isCurrent: (id: number) => boolean;
}

export function createRequestGuard(): RequestGuard {
  let current = 0;
  return { next: () => ++current, isCurrent: (id) => id === current };
}
