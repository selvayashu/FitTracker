/**
 * Dashboard and report calculations (Phase 3). Pure TypeScript: all date logic is UTC arithmetic on
 * YYYY-MM-DD strings, so results are identical in the browser, Node and Workers.
 *
 * Rounding rules: kcal figures (intake, active, BMR, out, net, allowance, remaining, averages) are whole
 * numbers; macro grams are 1 decimal; hours, distance, weights and BMI are 1 decimal; estimated weight change
 * is 2 decimals; percentages are whole numbers (largest-remainder where they must sum to 100).
 */
import { bmi as calcBmi, bmr as calcBmr, ageFromDob, dayAllowance, kcalToKg } from "./calc";
import type {
  DateRange,
  DayRow,
  RangeSummary,
  ReportActivity,
  ReportInputs,
  TodaySnapshot,
  TypeBreakdown,
} from "./reportTypes";
import type { MealType } from "./types";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "snack", "dinner"];
const SLOT_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Evening snack",
  dinner: "Dinner",
};
const DAY_MS = 86_400_000;

/** Rounds and normalises -0 to 0. */
const roundTo = (n: number, f: number): number => Math.round(n * f) / f + 0;
const round0 = (n: number): number => roundTo(n, 1);
const round1 = (n: number): number => roundTo(n, 10);
const round2 = (n: number): number => roundTo(n, 100);

// ---------------------------------------------------------------- dates

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return t;
}

function fmt(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function mustParse(date: string): number {
  const t = parseDate(date);
  if (t === null) throw new RangeError(`Invalid date: ${date}`);
  return t;
}

/** IST (UTC+05:30, no DST) calendar date of a UTC ISO instant. */
export function istDateOfIso(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid timestamp: ${iso}`);
  return fmt(ms + 5.5 * 3_600_000);
}

export function addDays(date: string, n: number): string {
  return fmt(mustParse(date) + n * DAY_MS);
}

function diffDays(a: string, b: string): number {
  return Math.round((mustParse(b) - mustParse(a)) / DAY_MS);
}

export function eachDate(range: DateRange): string[] {
  const out: string[] = [];
  const n = diffDays(range.from, range.to);
  for (let i = 0; i <= n; i++) out.push(addDays(range.from, i));
  return out;
}

export function presetRange(preset: "day" | "week" | "month", anchor: string): DateRange {
  const back = preset === "day" ? 0 : preset === "week" ? 6 : 29;
  return { from: addDays(anchor, -back), to: anchor };
}

export function shiftRange(range: DateRange, dir: -1 | 1, today: string): DateRange {
  const len = diffDays(range.from, range.to) + 1;
  if (dir === -1) return { from: addDays(range.from, -len), to: addDays(range.to, -len) };
  if (range.to >= today) return range;
  let to = addDays(range.to, len);
  if (to > today) to = today;
  return { from: addDays(to, -(len - 1)), to };
}

export function validateCustomRange(
  from: string,
  to: string,
  today: string,
  maxDays = 366,
): string | null {
  if (parseDate(from) === null || parseDate(to) === null) return "Enter a valid start and end date.";
  if (from > to) return "The start date must be on or before the end date.";
  if (to > today || from > today) return "Dates cannot be in the future.";
  if (diffDays(from, to) + 1 > maxDays) return `Choose a range no longer than ${maxDays} days.`;
  return null;
}

// ---------------------------------------------------------------- helpers

function sortedWeights(inputs: ReportInputs) {
  return inputs.weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => (a.w.date < b.w.date ? -1 : a.w.date > b.w.date ? 1 : a.i - b.i))
    .map((x) => x.w);
}

function activityDate(a: ReportActivity): string | null {
  return Number.isNaN(Date.parse(a.start_time)) ? null : istDateOfIso(a.start_time);
}

/** Largest-remainder rounding of shares so the integers sum to 100 (all zeros when the total is 0). */
function percentSplit(values: number[]): number[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((s, v) => s + v, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i] += 1;
    left -= 1;
  }
  return floors;
}

function weightedAvgHr(acts: ReportActivity[]): number | null {
  const withHr = acts.filter((a) => a.avg_hr !== null && a.avg_hr > 0);
  if (withHr.length === 0) return null;
  const w = withHr.reduce((s, a) => s + Math.max(0, a.duration_min), 0);
  if (w > 0) {
    return round0(
      withHr.reduce((s, a) => s + (a.avg_hr as number) * Math.max(0, a.duration_min), 0) / w,
    );
  }
  return round0(withHr.reduce((s, a) => s + (a.avg_hr as number), 0) / withHr.length);
}

function maxHrOf(acts: ReportActivity[]): number | null {
  let m: number | null = null;
  for (const a of acts) {
    if (a.max_hr !== null && a.max_hr > 0 && (m === null || a.max_hr > m)) m = a.max_hr;
  }
  return m;
}

/** Included activities (not excluded, IST date inside `dates`) grouped by date. */
function groupActivities(inputs: ReportInputs, dates: Set<string>): Map<string, ReportActivity[]> {
  const map = new Map<string, ReportActivity[]>();
  for (const a of inputs.activities) {
    if (a.excluded) continue;
    const d = activityDate(a);
    if (d === null || !dates.has(d)) continue;
    const list = map.get(d);
    if (list) list.push(a);
    else map.set(d, [a]);
  }
  return map;
}

function rangeDates(inputs: ReportInputs): string[] {
  const to = inputs.range.to > inputs.today ? inputs.today : inputs.range.to;
  if (inputs.range.from > to) return [];
  return eachDate({ from: inputs.range.from, to });
}

// ---------------------------------------------------------------- day rows

export function buildDayRows(inputs: ReportInputs): DayRow[] {
  const { profile } = inputs;
  const dates = rangeDates(inputs);
  const dateSet = new Set(dates);
  const acts = groupActivities(inputs, dateSet);
  const weights = sortedWeights(inputs);

  const mealsByDate = new Map<string, ReportInputs["meals"]>();
  for (const m of inputs.meals) {
    if (!dateSet.has(m.date)) continue;
    const list = mealsByDate.get(m.date);
    if (list) list.push(m);
    else mealsByDate.set(m.date, [m]);
  }

  return dates.map((date) => {
    const meals = mealsByDate.get(date) ?? [];
    const bySlot: Record<MealType, number> = { breakfast: 0, lunch: 0, snack: 0, dinner: 0 };
    let kcal = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;
    for (const m of meals) {
      kcal += m.kcal;
      protein += m.protein;
      carbs += m.carbs;
      fat += m.fat;
      bySlot[m.meal_type] += m.kcal;
    }
    for (const t of MEAL_TYPES) bySlot[t] = round0(bySlot[t]);

    const dayActs = acts.get(date) ?? [];
    let activeKcal = 0;
    let estimated = 0;
    let activeMin = 0;
    for (const a of dayActs) {
      const c = a.calories ?? 0;
      activeKcal += c;
      if (a.calories_estimated) estimated += c;
      activeMin += a.duration_min;
    }

    let weightKg = profile.weightKg;
    for (const w of weights) {
      if (w.date <= date) weightKg = w.weight_kg;
      else break;
    }
    const [y, mo, d] = date.split("-").map(Number);
    const age = ageFromDob(profile.dob, new Date(y, mo - 1, d));
    const bmrKcal = round0(
      calcBmr({ sex: profile.sex, weightKg, heightCm: profile.heightCm, ageYears: age }),
    );

    const kcalIn = round0(kcal);
    const active = round0(activeKcal);
    const kcalOut = bmrKcal + active;
    const allowance = dayAllowance(profile.dailyKcalTarget, active, profile.exerciseAddbackPct);
    const logged = meals.length > 0;
    return {
      date,
      logged,
      kcalIn,
      proteinG: round1(protein),
      carbsG: round1(carbs),
      fatG: round1(fat),
      bySlot,
      activeKcal: active,
      activeKcalEstimated: round0(estimated),
      activeMin: round1(activeMin),
      workouts: dayActs.length,
      bmr: bmrKcal,
      kcalOut,
      net: kcalIn - kcalOut,
      allowance,
      remaining: allowance - kcalIn,
      onTarget: logged && kcalIn <= allowance,
    };
  });
}

// ---------------------------------------------------------------- summary

export function summarizeRange(inputs: ReportInputs): RangeSummary {
  const { profile } = inputs;
  const days = buildDayRows(inputs);
  const dateSet = new Set(days.map((d) => d.date));
  const logged = days.filter((d) => d.logged);
  const nLogged = logged.length;
  const div = (n: number): number => (nLogged > 0 ? n / nLogged : 0);
  const sum = (f: (d: DayRow) => number, rows: DayRow[] = logged): number =>
    rows.reduce((s, d) => s + f(d), 0);

  const totalNet = sum((d) => d.net);
  const onTargetDays = logged.filter((d) => d.onTarget).length;
  const actsByDate = groupActivities(inputs, dateSet);
  const allActs = [...actsByDate.values()].flat();

  // activity
  const totalMinutes = round1(sum((d) => d.activeMin, days));
  const activeKcal = sum((d) => d.activeKcal, days);
  const estKcal = sum((d) => d.activeKcalEstimated, days);
  const byTypeMap = new Map<string, TypeBreakdown>();
  const bySource = {
    strava: { count: 0, minutes: 0 },
    manual: { count: 0, minutes: 0 },
  };
  let distance = 0;
  for (const a of allActs) {
    const base = inputs.typeNames[a.activity_type_id] ?? "Activity";
    const name =
      base.toLowerCase() === "other" && a.custom_name?.trim() ? a.custom_name.trim() : base;
    const key = name.toLowerCase();
    const cur = byTypeMap.get(key) ?? { name, count: 0, minutes: 0, kcal: 0 };
    cur.count += 1;
    cur.minutes += a.duration_min;
    cur.kcal += a.calories ?? 0;
    byTypeMap.set(key, cur);
    bySource[a.source].count += 1;
    bySource[a.source].minutes += a.duration_min;
    distance += a.distance_km ?? 0;
  }
  const byType = [...byTypeMap.values()]
    .map((t) => ({ ...t, minutes: round1(t.minutes), kcal: round0(t.kcal) }))
    .sort((a, b) => b.minutes - a.minutes || b.count - a.count || a.name.localeCompare(b.name));
  bySource.strava.minutes = round1(bySource.strava.minutes);
  bySource.manual.minutes = round1(bySource.manual.minutes);

  // heart rate
  const series: RangeSummary["hr"]["series"] = [];
  for (const d of days) {
    const list = actsByDate.get(d.date) ?? [];
    const avgHr = weightedAvgHr(list);
    const maxHr = maxHrOf(list);
    if (avgHr !== null || maxHr !== null) series.push({ date: d.date, avgHr, maxHr });
  }
  const zoneSeconds: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let hasZones = false;
  for (const a of allActs) {
    if (!a.zones) continue;
    hasZones = true;
    zoneSeconds[0] += a.zones.zone1_s;
    zoneSeconds[1] += a.zones.zone2_s;
    zoneSeconds[2] += a.zones.zone3_s;
    zoneSeconds[3] += a.zones.zone4_s;
    zoneSeconds[4] += a.zones.zone5_s;
  }

  // macros
  const avgP = round1(div(sum((d) => d.proteinG)));
  const avgC = round1(div(sum((d) => d.carbsG)));
  const avgF = round1(div(sum((d) => d.fatG)));
  const pct = (avg: number, target: number): number =>
    target > 0 ? round0((avg / target) * 100) : 0;
  const [sp, sc, sf] = percentSplit([avgP * 4, avgC * 4, avgF * 9]);

  // slots
  const slotTotals = MEAL_TYPES.map((s) => sum((d) => d.bySlot[s]));
  const slotPct = percentSplit(slotTotals);
  const slots = MEAL_TYPES.map((slot, i) => ({
    slot,
    avgKcal: round0(div(slotTotals[i])),
    pct: slotPct[i],
  }));

  // top foods
  const foodMap = new Map<string, { kcal: number; count: number; spellings: Map<string, number> }>();
  for (const m of inputs.meals) {
    if (!dateSet.has(m.date)) continue;
    const key = m.food_name.trim().toLowerCase();
    if (!key) continue;
    const cur = foodMap.get(key) ?? { kcal: 0, count: 0, spellings: new Map() };
    cur.kcal += m.kcal;
    cur.count += 1;
    const spelled = m.food_name.trim();
    cur.spellings.set(spelled, (cur.spellings.get(spelled) ?? 0) + 1);
    foodMap.set(key, cur);
  }
  const topFoods = [...foodMap.entries()]
    .map(([key, f]) => {
      let best = key;
      let bestN = -1;
      for (const [s, n] of f.spellings) {
        if (n > bestN) {
          best = s;
          bestN = n;
        }
      }
      return { name: best, kcal: round0(f.kcal), count: f.count };
    })
    .sort((a, b) => b.kcal - a.kcal || b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);

  // weight
  const weights = sortedWeights(inputs);
  const wSeries = weights
    .filter((w) => dateSet.has(w.date))
    .map((w) => ({
      date: w.date,
      weightKg: w.weight_kg,
      bmi: calcBmi(w.weight_kg, profile.heightCm),
    }));
  const startKg = wSeries.length > 0 ? wSeries[0].weightKg : null;
  const latestKg = wSeries.length > 0 ? wSeries[wSeries.length - 1].weightKg : null;
  const changeKg =
    wSeries.length >= 2 && startKg !== null && latestKg !== null
      ? round1(latestKg - startKg)
      : null;
  let progressPct: number | null = null;
  if (weights.length > 0) {
    if (profile.goal === "maintain") progressPct = 100;
    else {
      const first = weights[0].weight_kg;
      const upTo = inputs.range.to > inputs.today ? inputs.today : inputs.range.to;
      let latest = first;
      for (const w of weights) {
        if (w.date <= upTo) latest = w.weight_kg;
        else break;
      }
      const span = profile.targetWeightKg - first;
      if (Math.abs(span) < 1e-9) progressPct = 100;
      else progressPct = round1(Math.min(100, Math.max(0, ((latest - first) / span) * 100)));
    }
  }

  return {
    range: inputs.range,
    days,
    totalDays: days.length,
    loggedDays: nLogged,
    unloggedDays: days.length - nLogged,
    onTargetDays,
    overTargetDays: nLogged - onTargetDays,
    avgKcalIn: round0(div(sum((d) => d.kcalIn))),
    avgKcalOut: round0(div(sum((d) => d.kcalOut))),
    avgNet: round0(div(totalNet)),
    totalNet,
    estimatedWeightChangeKg: round2(kcalToKg(totalNet)),
    activity: {
      totalMinutes,
      totalHours: round1(totalMinutes / 60),
      activeDays: days.filter((d) => d.workouts > 0).length,
      workouts: sum((d) => d.workouts, days),
      distanceKm: round1(distance),
      activeKcal,
      estimatedShare: activeKcal > 0 ? Math.min(1, Math.max(0, estKcal / activeKcal)) : 0,
      byType,
      bySource,
    },
    hr: {
      hasData: series.length > 0 || hasZones,
      series,
      overallAvg: weightedAvgHr(allActs),
      overallMax: maxHrOf(allActs),
      zoneSeconds,
    },
    macros: {
      avgProteinG: avgP,
      avgCarbsG: avgC,
      avgFatG: avgF,
      targets: {
        proteinG: profile.proteinTargetG,
        carbsG: profile.carbTargetG,
        fatG: profile.fatTargetG,
      },
      pctOfTarget: {
        protein: pct(avgP, profile.proteinTargetG),
        carbs: pct(avgC, profile.carbTargetG),
        fat: pct(avgF, profile.fatTargetG),
      },
      kcalSplitPct: { protein: sp, carbs: sc, fat: sf },
    },
    slots,
    topFoods,
    weight: { series: wSeries, startKg, latestKg, changeKg, progressPct },
  };
}

// ---------------------------------------------------------------- insights

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const dayWord = (n: number): string => plural(n, "day", "days");

function thousands(n: number): string {
  return String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function buildInsights(summary: RangeSummary): string[] {
  const out: string[] = [];
  const { loggedDays, totalDays, activity } = summary;
  if (totalDays <= 0 || (loggedDays === 0 && activity.workouts === 0)) return out;

  if (loggedDays > 0) {
    const top = [...summary.slots].sort((a, b) => b.pct - a.pct)[0];
    if (top && top.pct > 0) out.push(`${SLOT_LABEL[top.slot]} was ${top.pct}% of your intake.`);
  }
  if (activity.workouts > 0) {
    out.push(`You were active ${activity.activeDays} of ${totalDays} ${dayWord(totalDays)}.`);
  }
  if (loggedDays > 0) {
    out.push(
      `You stayed within your allowance on ${summary.onTargetDays} of ${loggedDays} logged ${dayWord(loggedDays)}.`,
    );
  }
  if (loggedDays > 0 && summary.unloggedDays > 0) {
    out.push(`You logged meals on ${loggedDays} of ${totalDays} ${dayWord(totalDays)}.`);
  }
  if (loggedDays > 0) {
    const p = summary.macros.pctOfTarget.protein;
    if (summary.macros.targets.proteinG > 0) {
      if (p < 80) {
        out.push(`Protein averaged ${p}% of your target; adding a protein-rich food could help.`);
      } else if (p > 120) {
        out.push(`Protein averaged ${p}% of your target, above what you aimed for.`);
      }
    }
    const net = summary.avgNet;
    if (net < 0) {
      out.push(`On logged days you averaged an estimated deficit of ${thousands(net)} kcal per day.`);
    } else if (net > 0) {
      out.push(`On logged days you averaged an estimated surplus of ${thousands(net)} kcal per day.`);
    } else {
      out.push("On logged days your estimated intake matched your estimated burn.");
    }
    const kg = summary.estimatedWeightChangeKg;
    if (kg !== 0) {
      out.push(
        `That is an estimated ${kg < 0 ? "loss" : "gain"} of about ${Math.abs(kg).toFixed(2)} kg (about 7,700 kcal per kg; real change varies).`,
      );
    }
    const food = summary.topFoods[0];
    if (food && food.kcal > 0) {
      out.push(
        `${food.name} was your highest-calorie food (${thousands(food.kcal)} kcal over ${food.count} ${plural(food.count, "entry", "entries")}).`,
      );
    }
  }
  if (activity.activeKcal > 0 && activity.estimatedShare >= 0.5) {
    out.push(
      `${Math.round(activity.estimatedShare * 100)}% of your active calories are estimated from activity type and duration, so treat them as approximate.`,
    );
  }
  return out.slice(0, 8);
}

// ---------------------------------------------------------------- today

export function todaySnapshot(inputs: ReportInputs): TodaySnapshot {
  const date = inputs.today;
  const scoped: ReportInputs = { ...inputs, range: { from: date, to: date } };
  const [row] = buildDayRows(scoped);
  const { profile } = inputs;
  const acts = groupActivities(scoped, new Set([date])).get(date) ?? [];
  return {
    date,
    consumedKcal: row.kcalIn,
    targetKcal: profile.dailyKcalTarget,
    addbackKcal: row.allowance - profile.dailyKcalTarget,
    allowanceKcal: row.allowance,
    remainingKcal: row.remaining,
    over: row.kcalIn > row.allowance,
    burnedKcal: row.kcalOut,
    bmr: row.bmr,
    activeKcal: row.activeKcal,
    netKcal: row.net,
    activeMinutes: row.activeMin,
    workouts: row.workouts,
    avgHr: weightedAvgHr(acts),
    macros: { proteinG: row.proteinG, carbsG: row.carbsG, fatG: row.fatG },
    macroTargets: {
      proteinG: profile.proteinTargetG,
      carbsG: profile.carbTargetG,
      fatG: profile.fatTargetG,
    },
    slotKcal: row.bySlot,
  };
}
