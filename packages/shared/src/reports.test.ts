import { describe, expect, it } from "vitest";
import {
  addDays,
  buildDayRows,
  buildInsights,
  eachDate,
  istDateOfIso,
  presetRange,
  shiftRange,
  summarizeRange,
  todaySnapshot,
  validateCustomRange,
} from "./reports";
import type {
  ReportActivity,
  ReportInputs,
  ReportMeal,
  ReportProfile,
  ReportWeight,
} from "./reportTypes";

// Female, 162 cm, 68 kg, born 1993-06-15 (32 on every test date in March 2026).
// BMR(68 kg) = 10*68 + 6.25*162 - 5*32 - 161 = 680 + 1012.5 - 160 - 161 = 1371.5 -> 1372
// BMR(66 kg) = 660 + 1012.5 - 160 - 161 = 1351.5 -> 1352
// BMR(65 kg) = 650 + 1012.5 - 160 - 161 = 1341.5 -> 1342
const profile: ReportProfile = {
  sex: "female",
  dob: "1993-06-15",
  heightCm: 162,
  weightKg: 68,
  targetWeightKg: 60,
  goal: "lose",
  pace: 0.25,
  bmiStandard: "asian",
  dailyKcalTarget: 1500,
  proteinTargetG: 95,
  carbTargetG: 170,
  fatTargetG: 45,
  exerciseAddbackPct: 50,
};

const TODAY = "2026-03-10";
const WEEK = { from: "2026-03-04", to: TODAY };

function meal(
  date: string,
  meal_type: ReportMeal["meal_type"],
  food_name: string,
  kcal: number,
  protein = 10,
  carbs = 20,
  fat = 5,
): ReportMeal {
  return { date, meal_type, food_name, kcal, protein, carbs, fat };
}

function act(over: Partial<ReportActivity> & { id: string; start_time: string }): ReportActivity {
  return {
    activity_type_id: 1,
    custom_name: null,
    name: null,
    source: "manual",
    duration_min: 30,
    distance_km: null,
    avg_hr: null,
    max_hr: null,
    calories: null,
    calories_estimated: false,
    excluded: false,
    zones: null,
    ...over,
  };
}

function inputs(over: Partial<ReportInputs> = {}): ReportInputs {
  return {
    range: WEEK,
    today: TODAY,
    profile,
    meals: [],
    activities: [],
    weights: [],
    typeNames: { 1: "Run", 2: "Walk", 99: "Other" },
    ...over,
  };
}

/**
 * Fixture (week 2026-03-04..03-10, 4 unlogged days):
 *  03-06 logged: Oats 300 + Rice 600 + dal 600 = 1500 (allowance 1500, exactly equal -> on target)
 *  03-08 logged: Rice 2000 (over)
 *  03-10 logged: oats 400 + rice 600 = 1000; Run 40 min 300 kcal (estimated) + Padel (Other) 20 min 100 kcal
 *  every meal has P10 C20 F5.
 */
const runZones = { zone1_s: 60, zone2_s: 120, zone3_s: 180, zone4_s: 240, zone5_s: 300 };
const fixture = (): ReportInputs =>
  inputs({
    meals: [
      meal("2026-03-06", "breakfast", "Oats", 300),
      meal("2026-03-06", "lunch", "Rice", 600),
      meal("2026-03-06", "dinner", "dal", 600),
      meal("2026-03-08", "dinner", "Rice", 2000),
      meal("2026-03-10", "breakfast", "oats", 400),
      meal("2026-03-10", "dinner", "rice", 600),
    ],
    activities: [
      act({
        id: "run",
        start_time: "2026-03-10T02:00:00Z",
        source: "strava",
        duration_min: 40,
        distance_km: 5,
        avg_hr: 140,
        max_hr: 165,
        calories: 300,
        calories_estimated: true,
        zones: runZones,
      }),
      // 18:45Z on 03-09 is 00:15 IST on 03-10
      act({
        id: "padel",
        start_time: "2026-03-09T18:45:00Z",
        activity_type_id: 99,
        custom_name: "Padel",
        duration_min: 20,
        avg_hr: 120,
        calories: 100,
      }),
      act({
        id: "dup",
        start_time: "2026-03-10T03:00:00Z",
        duration_min: 60,
        calories: 999,
        avg_hr: 190,
        excluded: true,
      }),
    ],
    // 03-06 uses the profile weight (68), 03-08 uses 66, 03-10 uses 65 (log from 03-09)
    weights: [
      { date: "2026-03-09", weight_kg: 65 },
      { date: "2026-03-08", weight_kg: 66 },
    ],
  });

function allFinite(value: unknown, path = "$"): string[] {
  const bad: string[] = [];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) bad.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => bad.push(...allFinite(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) bad.push(...allFinite(v, `${path}.${k}`));
  }
  return bad;
}

describe("dates", () => {
  it("istDateOfIso crosses midnight at 18:30Z", () => {
    expect(istDateOfIso("2026-03-05T18:29:00Z")).toBe("2026-03-05");
    expect(istDateOfIso("2026-03-05T18:30:00Z")).toBe("2026-03-06");
    expect(istDateOfIso("2026-12-31T20:00:00Z")).toBe("2027-01-01");
    expect(istDateOfIso("2026-03-05T00:00:00+05:30")).toBe("2026-03-05");
  });

  it("addDays handles month, year and leap boundaries", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-03-31", 30)).toBe("2026-04-30");
    expect(addDays("2026-03-10", 0)).toBe("2026-03-10");
  });

  it("eachDate is inclusive", () => {
    expect(eachDate({ from: "2024-02-28", to: "2024-03-01" })).toEqual([
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
    expect(eachDate({ from: "2026-03-10", to: "2026-03-10" })).toEqual(["2026-03-10"]);
  });

  it("presetRange", () => {
    expect(presetRange("day", TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(presetRange("week", TODAY)).toEqual({ from: "2026-03-04", to: TODAY });
    // Mar 10 minus 29 days: 10 -> Feb 28 is 10 days, 19 more -> Feb 9
    expect(presetRange("month", TODAY)).toEqual({ from: "2026-02-09", to: TODAY });
  });

  it("shiftRange moves by the range length and clamps at today", () => {
    expect(shiftRange(WEEK, -1, TODAY)).toEqual({ from: "2026-02-25", to: "2026-03-03" });
    expect(shiftRange({ from: "2026-02-25", to: "2026-03-03" }, 1, TODAY)).toEqual(WEEK);
    expect(shiftRange(WEEK, 1, TODAY)).toEqual(WEEK);
    expect(shiftRange({ from: "2026-03-01", to: "2026-03-07" }, 1, TODAY)).toEqual(WEEK);
    expect(shiftRange({ from: TODAY, to: TODAY }, -1, TODAY)).toEqual({
      from: "2026-03-09",
      to: "2026-03-09",
    });
  });

  it("validateCustomRange", () => {
    expect(validateCustomRange("2026-03-01", "2026-03-10", TODAY)).toBeNull();
    expect(validateCustomRange("2026-02-30", "2026-03-01", TODAY)).toMatch(/valid/);
    expect(validateCustomRange("", "2026-03-01", TODAY)).toMatch(/valid/);
    expect(validateCustomRange("2026-03-05", "2026-03-04", TODAY)).toMatch(/before/);
    expect(validateCustomRange("2026-03-05", "2026-03-11", TODAY)).toMatch(/future/);
    // 2025-03-11..2026-03-10 inclusive is 365 days; 2025-01-01..2026-03-10 is 434
    expect(validateCustomRange("2025-03-11", "2026-03-10", TODAY)).toBeNull();
    expect(validateCustomRange("2025-01-01", "2026-03-10", TODAY)).toMatch(/366/);
    expect(validateCustomRange("2026-03-01", "2026-03-08", TODAY, 7)).toMatch(/7 days/);
    expect(validateCustomRange("2026-03-02", "2026-03-08", TODAY, 7)).toBeNull();
  });
});

describe("buildDayRows", () => {
  it("never includes days after today", () => {
    const rows = buildDayRows(inputs({ range: { from: "2026-03-08", to: "2026-03-14" } }));
    expect(rows.map((r) => r.date)).toEqual(["2026-03-08", "2026-03-09", "2026-03-10"]);
    expect(buildDayRows(inputs({ range: { from: "2026-03-11", to: "2026-03-14" } }))).toEqual([]);
  });

  it("logged day: sums, slots, allowance and BMR", () => {
    const row = buildDayRows(fixture()).find((r) => r.date === "2026-03-06")!;
    expect(row.logged).toBe(true);
    expect(row.kcalIn).toBe(1500); // 300 + 600 + 600
    expect(row.bySlot).toEqual({ breakfast: 300, lunch: 600, snack: 0, dinner: 600 });
    expect(row.proteinG).toBe(30);
    expect(row.carbsG).toBe(60);
    expect(row.fatG).toBe(15);
    expect(row.bmr).toBe(1372);
    expect(row.kcalOut).toBe(1372);
    expect(row.net).toBe(128); // 1500 - 1372
    expect(row.allowance).toBe(1500);
    expect(row.remaining).toBe(0);
    expect(row.onTarget).toBe(true); // exactly equal counts
  });

  it("unlogged day", () => {
    const row = buildDayRows(fixture()).find((r) => r.date === "2026-03-05")!;
    expect(row.logged).toBe(false);
    expect(row.kcalIn).toBe(0);
    expect(row.bySlot).toEqual({ breakfast: 0, lunch: 0, snack: 0, dinner: 0 });
    expect(row.onTarget).toBe(false);
    expect(row.remaining).toBe(1500);
  });

  it("BMR uses the weight in effect (mid-range weight change)", () => {
    const rows = buildDayRows(fixture());
    const bmr = (d: string) => rows.find((r) => r.date === d)!.bmr;
    expect(bmr("2026-03-07")).toBe(1372); // profile 68 kg
    expect(bmr("2026-03-08")).toBe(1352); // log 66
    expect(bmr("2026-03-09")).toBe(1342); // log 65
    expect(bmr("2026-03-10")).toBe(1342);
  });

  it("activity day: excluded ignored, IST date, estimated split, add-back", () => {
    const row = buildDayRows(fixture()).find((r) => r.date === "2026-03-10")!;
    expect(row.workouts).toBe(2); // run + padel, duplicate excluded
    expect(row.activeKcal).toBe(400); // 300 + 100 (not 999)
    expect(row.activeKcalEstimated).toBe(300);
    expect(row.activeMin).toBe(60);
    expect(row.kcalOut).toBe(1742); // 1342 + 400
    expect(row.net).toBe(-742); // 1000 - 1742
    expect(row.allowance).toBe(1700); // 1500 + 50% of 400
    expect(row.remaining).toBe(700);
    expect(row.onTarget).toBe(true);
  });

  it("activity-only day is not logged", () => {
    const row = buildDayRows(
      inputs({
        range: { from: "2026-03-09", to: "2026-03-09" },
        activities: [act({ id: "w", start_time: "2026-03-09T03:00:00Z", calories: null })],
      }),
    )[0];
    expect(row.logged).toBe(false);
    expect(row.workouts).toBe(1);
    expect(row.activeKcal).toBe(0); // null calories count 0
    expect(row.onTarget).toBe(false);
  });

  it("add-back edge: allowance 1500 + 50% of 300 = 1650", () => {
    const base = (kcal: number) =>
      buildDayRows(
        inputs({
          range: { from: TODAY, to: TODAY },
          meals: [meal(TODAY, "lunch", "x", kcal)],
          activities: [act({ id: "a", start_time: "2026-03-10T02:00:00Z", calories: 300 })],
        }),
      )[0];
    expect(base(1650).onTarget).toBe(true);
    expect(base(1650).remaining).toBe(0);
    expect(base(1651).onTarget).toBe(false);
    expect(base(1651).remaining).toBe(-1);
  });
});

describe("summarizeRange", () => {
  const s = summarizeRange(fixture());

  it("counts and logged-only averages", () => {
    expect(s.totalDays).toBe(7);
    expect(s.loggedDays).toBe(3);
    expect(s.unloggedDays).toBe(4);
    expect(s.onTargetDays).toBe(2); // 03-06 (equal), 03-10; 03-08 over
    expect(s.overTargetDays).toBe(1);
    expect(s.avgKcalIn).toBe(1500); // (1500 + 2000 + 1000) / 3
    // out: 1372, 1352 (03-08: 66 kg), 1742 -> 4466 / 3 = 1488.67
    expect(s.avgKcalOut).toBe(1489);
    // nets: 128 + 648 + (-742) = 34 -> 11.33
    expect(s.totalNet).toBe(34);
    expect(s.avgNet).toBe(11);
    expect(s.estimatedWeightChangeKg).toBe(0); // 34 / 7700 = 0.004
  });

  it("activity totals", () => {
    expect(s.activity.totalMinutes).toBe(60);
    expect(s.activity.totalHours).toBe(1);
    expect(s.activity.activeDays).toBe(1);
    expect(s.activity.workouts).toBe(2);
    expect(s.activity.distanceKm).toBe(5);
    expect(s.activity.activeKcal).toBe(400);
    expect(s.activity.estimatedShare).toBe(0.75); // 300 / 400
    expect(s.activity.byType).toEqual([
      { name: "Run", count: 1, minutes: 40, kcal: 300 },
      { name: "Padel", count: 1, minutes: 20, kcal: 100 },
    ]);
    expect(s.activity.bySource).toEqual({
      strava: { count: 1, minutes: 40 },
      manual: { count: 1, minutes: 20 },
    });
  });

  it("heart rate is duration weighted and zones are summed", () => {
    // (140*40 + 120*20) / 60 = 8000 / 60 = 133.33
    expect(s.hr.hasData).toBe(true);
    expect(s.hr.series).toEqual([{ date: "2026-03-10", avgHr: 133, maxHr: 165 }]);
    expect(s.hr.overallAvg).toBe(133);
    expect(s.hr.overallMax).toBe(165);
    expect(s.hr.zoneSeconds).toEqual([60, 120, 180, 240, 300]);
  });

  it("macros", () => {
    // 6 meals x P10 C20 F5 over 3 logged days: 20 / 40 / 10
    expect(s.macros.avgProteinG).toBe(20);
    expect(s.macros.avgCarbsG).toBe(40);
    expect(s.macros.avgFatG).toBe(10);
    expect(s.macros.pctOfTarget).toEqual({ protein: 21, carbs: 24, fat: 22 });
    // kcal 80 / 160 / 90 = 330 -> 24.24 / 48.48 / 27.27 -> floors 24/48/27, carbs gets the spare 1
    expect(s.macros.kcalSplitPct).toEqual({ protein: 24, carbs: 49, fat: 27 });
    const t = s.macros.kcalSplitPct;
    expect(t.protein + t.carbs + t.fat).toBe(100);
  });

  it("slots", () => {
    // totals: breakfast 700, lunch 600, snack 0, dinner 3200 (of 4500)
    expect(s.slots.map((x) => x.slot)).toEqual(["breakfast", "lunch", "snack", "dinner"]);
    expect(s.slots.map((x) => x.avgKcal)).toEqual([233, 200, 0, 1067]);
    expect(s.slots.map((x) => x.pct)).toEqual([16, 13, 0, 71]);
    expect(s.slots.reduce((a, x) => a + x.pct, 0)).toBe(100);
  });

  it("top foods group case-insensitively and sort by kcal", () => {
    expect(s.topFoods).toEqual([
      { name: "Rice", kcal: 3200, count: 3 },
      { name: "Oats", kcal: 700, count: 2 },
      { name: "dal", kcal: 600, count: 1 },
    ]);
  });

  it("weight series, change and progress", () => {
    expect(s.weight.series).toEqual([
      { date: "2026-03-08", weightKg: 66, bmi: 25.1 }, // 66 / 2.6244 = 25.148
      { date: "2026-03-09", weightKg: 65, bmi: 24.8 },
    ]);
    expect(s.weight.startKg).toBe(66);
    expect(s.weight.latestKg).toBe(65);
    expect(s.weight.changeKg).toBe(-1);
    // first ever 66 -> target 60, latest 65: 1 / 6 = 16.7%
    expect(s.weight.progressPct).toBe(16.7);
  });

  it("weight edge cases", () => {
    const one = summarizeRange(inputs({ weights: [{ date: "2026-03-08", weight_kg: 66 }] }));
    expect(one.weight.changeKg).toBeNull();
    expect(one.weight.startKg).toBe(66);
    expect(one.weight.progressPct).toBe(0);

    const none = summarizeRange(inputs());
    expect(none.weight.progressPct).toBeNull();
    expect(none.weight.startKg).toBeNull();

    const maintain = summarizeRange(
      inputs({
        profile: { ...profile, goal: "maintain" },
        weights: [{ date: "2026-03-08", weight_kg: 66 }],
      }),
    );
    expect(maintain.weight.progressPct).toBe(100);

    const past: ReportWeight[] = [
      { date: "2026-01-01", weight_kg: 70 },
      { date: "2026-03-01", weight_kg: 50 },
    ];
    // beyond the target -> clamped to 100; weight rising away -> clamped to 0
    expect(summarizeRange(inputs({ weights: past })).weight.progressPct).toBe(100);
    const away: ReportWeight[] = [
      { date: "2026-01-01", weight_kg: 70 },
      { date: "2026-03-01", weight_kg: 75 },
    ];
    expect(summarizeRange(inputs({ weights: away })).weight.progressPct).toBe(0);
  });

  it("empty inputs produce finite numbers everywhere", () => {
    const e = summarizeRange(inputs());
    expect(e.loggedDays).toBe(0);
    expect(e.unloggedDays).toBe(7);
    expect(e.avgKcalIn).toBe(0);
    expect(e.avgNet).toBe(0);
    expect(e.estimatedWeightChangeKg).toBe(0);
    expect(Object.is(e.estimatedWeightChangeKg, -0)).toBe(false);
    expect(e.activity.estimatedShare).toBe(0);
    expect(e.hr.hasData).toBe(false);
    expect(e.hr.overallAvg).toBeNull();
    expect(e.macros.kcalSplitPct).toEqual({ protein: 0, carbs: 0, fat: 0 });
    expect(e.slots.every((x) => x.pct === 0 && x.avgKcal === 0)).toBe(true);
    expect(e.topFoods).toEqual([]);
    expect(allFinite(e)).toEqual([]);
    expect(allFinite(s)).toEqual([]);
    expect(buildInsights(e)).toEqual([]);
    // an empty (all-future) range is also safe
    const f = summarizeRange(inputs({ range: { from: "2026-03-11", to: "2026-03-12" } }));
    expect(f.totalDays).toBe(0);
    expect(allFinite(f)).toEqual([]);
    expect(buildInsights(f)).toEqual([]);
  });

  it("excluded activities do not appear in HR, zones or types", () => {
    expect(s.hr.overallMax).toBe(165); // the excluded 190 is ignored
    expect(s.activity.byType.reduce((a, t) => a + t.count, 0)).toBe(2);
  });
});

describe("buildInsights", () => {
  it("fixture insights, capped at 8, no NaN", () => {
    const out = buildInsights(summarizeRange(fixture()));
    expect(out).toEqual([
      "Dinner was 71% of your intake.",
      "You were active 1 of 7 days.",
      "You stayed within your allowance on 2 of 3 logged days.",
      "You logged meals on 3 of 7 days.",
      "Protein averaged 21% of your target; adding a protein-rich food could help.",
      "On logged days you averaged an estimated surplus of 11 kcal per day.",
      "Rice was your highest-calorie food (3,200 kcal over 3 entries).",
      "75% of your active calories are estimated from activity type and duration, so treat them as approximate.",
    ]);
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out.join(" ")).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("singular wording, weight caveat and deficit wording", () => {
    // one day, 2000 kcal, 1352... profile 68 kg -> BMR 1372, net 628, 628 / 7700 = 0.0816 -> 0.08
    const gain = buildInsights(
      summarizeRange(
        inputs({
          range: { from: TODAY, to: TODAY },
          meals: [meal(TODAY, "dinner", "Biryani", 2000, 80, 200, 40)],
          activities: [act({ id: "a", start_time: "2026-03-10T02:00:00Z" })],
        }),
      ),
    );
    expect(gain).toContain("Dinner was 100% of your intake.");
    expect(gain).toContain("You were active 1 of 1 day.");
    expect(gain).toContain("You stayed within your allowance on 0 of 1 logged day.");
    expect(gain).toContain("On logged days you averaged an estimated surplus of 628 kcal per day.");
    expect(gain.some((x) => x.includes("estimated gain of about 0.08 kg") && x.includes("7,700"))).toBe(
      true,
    );
    expect(gain).toContain("Biryani was your highest-calorie food (2,000 kcal over 1 entry).");
    expect(gain.some((x) => x.includes("logged meals on"))).toBe(false); // no unlogged days

    const loss = buildInsights(
      summarizeRange(
        inputs({
          range: { from: TODAY, to: TODAY },
          meals: [meal(TODAY, "lunch", "Salad", 372, 120, 20, 5)],
        }),
      ),
    );
    // net = 372 - 1372 = -1000; -1000 / 7700 = -0.13
    expect(loss).toContain("On logged days you averaged an estimated deficit of 1,000 kcal per day.");
    expect(loss.some((x) => x.includes("estimated loss of about 0.13 kg"))).toBe(true);
    expect(loss.some((x) => x.includes("above what you aimed for"))).toBe(true); // 120 / 95 = 126%
  });

  it("activity-only range yields activity insights only", () => {
    const out = buildInsights(
      summarizeRange(
        inputs({ activities: [act({ id: "a", start_time: "2026-03-10T02:00:00Z", calories: 100 })] }),
      ),
    );
    expect(out).toEqual(["You were active 1 of 7 days."]);
  });
});

describe("todaySnapshot", () => {
  it("under allowance", () => {
    const t = todaySnapshot({ ...fixture(), range: { from: TODAY, to: TODAY } });
    expect(t.date).toBe(TODAY);
    expect(t.consumedKcal).toBe(1000);
    expect(t.targetKcal).toBe(1500);
    expect(t.addbackKcal).toBe(200);
    expect(t.allowanceKcal).toBe(1700);
    expect(t.remainingKcal).toBe(700);
    expect(t.over).toBe(false);
    expect(t.burnedKcal).toBe(1742);
    expect(t.bmr).toBe(1342);
    expect(t.activeKcal).toBe(400);
    expect(t.netKcal).toBe(-742);
    expect(t.activeMinutes).toBe(60);
    expect(t.workouts).toBe(2);
    expect(t.avgHr).toBe(133);
    expect(t.macros).toEqual({ proteinG: 20, carbsG: 40, fatG: 10 });
    expect(t.macroTargets).toEqual({ proteinG: 95, carbsG: 170, fatG: 45 });
    expect(t.slotKcal).toEqual({ breakfast: 400, lunch: 0, snack: 0, dinner: 600 });
  });

  it("over allowance, no activity, no HR", () => {
    const t = todaySnapshot(
      inputs({
        range: { from: TODAY, to: TODAY },
        meals: [meal(TODAY, "dinner", "Feast", 1600)],
      }),
    );
    expect(t.allowanceKcal).toBe(1500);
    expect(t.remainingKcal).toBe(-100);
    expect(t.over).toBe(true);
    expect(t.avgHr).toBeNull();
    expect(t.bmr).toBe(1372);
    expect(allFinite(t)).toEqual([]);
  });
});
