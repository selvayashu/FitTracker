import { describe, expect, it } from "vitest";
import type { DayRow, RangeSummary } from "@fittrack/shared";
import {
  calorieChartData, calorieSummaryText, createRequestGuard, fmtInt, fmtSigned, hrData, macroData, netSummaryText, plural, rangeLabel,
  safe, shortDate, sourceSummaryText, tickInterval, typeSummaryText, weightChangeText, zoneData, zoneSummaryText,
} from "./logic";

const day = (o: Partial<DayRow>): DayRow => ({
  date: "2026-10-30", logged: true, kcalIn: 1800, proteinG: 0, carbsG: 0, fatG: 0,
  bySlot: { breakfast: 0, lunch: 0, snack: 0, dinner: 0 }, activeKcal: 0, activeKcalEstimated: 0, activeMin: 0, workouts: 0,
  bmr: 1600, kcalOut: 2000, net: -200, allowance: 1800, remaining: 0, onTarget: true, ...o,
});

function summary(o: Partial<RangeSummary> = {}): RangeSummary {
  return {
    range: { from: "2026-10-25", to: "2026-10-31" }, days: [], totalDays: 7, loggedDays: 0, unloggedDays: 7, onTargetDays: 0, overTargetDays: 0,
    avgKcalIn: 0, avgKcalOut: 0, avgNet: 0, totalNet: 0, estimatedWeightChangeKg: 0,
    activity: {
      totalMinutes: 0, totalHours: 0, activeDays: 0, workouts: 0, distanceKm: 0, activeKcal: 0, estimatedShare: 0, byType: [],
      bySource: { strava: { count: 0, minutes: 0 }, manual: { count: 0, minutes: 0 } },
    },
    hr: { hasData: false, series: [], overallAvg: null, overallMax: null, zoneSeconds: [0, 0, 0, 0, 0] },
    macros: {
      avgProteinG: 0, avgCarbsG: 0, avgFatG: 0, targets: { proteinG: 100, carbsG: 200, fatG: 60 },
      pctOfTarget: { protein: 0, carbs: 0, fat: 0 }, kcalSplitPct: { protein: 0, carbs: 0, fat: 0 },
    },
    slots: [], topFoods: [], weight: { series: [], startKg: null, latestKg: null, changeKg: null, progressPct: null },
    ...o,
  };
}

describe("calorieChartData", () => {
  it("never plots an unlogged day as a zero intake", () => {
    const d = calorieChartData([day({}), day({ date: "2026-10-31", logged: false, kcalIn: 0, net: -2000 })]);
    expect(d[0]?.kcalIn).toBe(1800);
    expect(d[0]?.notLogged).toBeNull();
    expect(d[1]?.kcalIn).toBeNull();
    expect(d[1]?.net).toBeNull();
    expect(d[1]?.notLogged).toBeGreaterThan(0);
    expect(d[1]?.kcalOut).toBe(2000);
  });
  it("handles empty input and NaN", () => {
    expect(calorieChartData([])).toEqual([]);
    const d = calorieChartData([day({ kcalOut: NaN, kcalIn: Infinity, net: NaN })]);
    expect(d[0]?.kcalIn).toBe(0);
    expect(d[0]?.kcalOut).toBe(0);
    expect(d[0]?.net).toBe(0);
  });
});

describe("tickInterval", () => {
  it("shows all labels for 7 points and thins 30 and 366", () => {
    expect(tickInterval(7)).toBe(0);
    expect(tickInterval(1)).toBe(0);
    expect(tickInterval(30)).toBe(4);
    expect(tickInterval(366)).toBe(52);
    expect(Math.ceil(366 / (tickInterval(366) + 1))).toBeLessThanOrEqual(7);
  });
  it("is safe for bad input", () => {
    expect(tickInterval(NaN)).toBe(0);
    expect(tickInterval(Infinity)).toBe(0);
    expect(tickInterval(30, 0)).toBe(29);
  });
});

describe("formatting", () => {
  it("survives NaN and Infinity", () => {
    expect(safe(NaN)).toBe(0);
    expect(safe(-Infinity)).toBe(0);
    expect(safe(null)).toBe(0);
    expect(fmtInt(NaN)).toBe("0");
    expect(fmtSigned(Infinity)).toBe("0");
    expect(fmtSigned(-250)).toBe("-250");
    expect(fmtSigned(250)).toBe("+250");
    expect(fmtInt(12345)).toBe("12,345");
  });
  it("plural", () => {
    expect(plural(1, "day")).toBe("1 day");
    expect(plural(2, "day")).toBe("2 days");
    expect(plural(0, "activity", "activities")).toBe("0 activities");
    expect(plural(1, "activity", "activities")).toBe("1 activity");
  });
  it("range labels", () => {
    expect(shortDate("2026-10-05")).toBe("5 Oct");
    expect(shortDate("bad")).toBe("bad");
    expect(rangeLabel({ from: "2026-10-31", to: "2026-10-31" })).toBe("31 Oct 2026");
    expect(rangeLabel({ from: "2026-10-25", to: "2026-10-31" })).toBe("25 Oct to 31 Oct 2026");
    expect(rangeLabel({ from: "2025-12-25", to: "2026-01-02" })).toBe("25 Dec 2025 to 2 Jan 2026");
  });
});

describe("summary strings", () => {
  it("empty summary", () => {
    const s = summary();
    expect(calorieSummaryText(s)).toBe("No meals logged in this range.");
    expect(netSummaryText(s)).toContain("No net balance");
    expect(weightChangeText(s)).toContain("Not available");
    expect(typeSummaryText(s)).toBe("No activities in this range.");
    expect(sourceSummaryText(s)).toBe("No activities in this range.");
    expect(zoneSummaryText(s)).toContain("No heart-rate zone data");
    expect(macroData(s)).toHaveLength(3);
  });
  it("singular and plural", () => {
    expect(calorieSummaryText(summary({ loggedDays: 1, unloggedDays: 1, avgKcalIn: 1800, avgKcalOut: 2100 })))
      .toBe("Average 1,800 kcal in, 2,100 kcal out (estimated) over 1 logged day (1 day not logged).");
    expect(calorieSummaryText(summary({ loggedDays: 3, unloggedDays: 0, avgKcalIn: 1, avgKcalOut: 2 })))
      .toBe("Average 1 kcal in, 2 kcal out (estimated) over 3 logged days.");
    expect(typeSummaryText(summary({ activity: { ...summary().activity, workouts: 1, totalHours: 1, activeDays: 1 } })))
      .toBe("1 activity, 1.0 h in total across 1 active day.");
  });
  it("NaN safe", () => {
    expect(calorieSummaryText(summary({ loggedDays: 2, avgKcalIn: NaN, avgKcalOut: Infinity }))).toContain("0 kcal in");
    expect(weightChangeText(summary({ loggedDays: 2, estimatedWeightChangeKg: NaN }))).toContain("0.00 kg");
  });
  it("weight change sign", () => {
    expect(weightChangeText(summary({ loggedDays: 2, estimatedWeightChangeKg: -0.45 }))).toBe("-0.45 kg (estimated, loss)");
    expect(weightChangeText(summary({ loggedDays: 2, estimatedWeightChangeKg: 0.2 }))).toBe("+0.20 kg (estimated, gain)");
  });
});

describe("hr and zones", () => {
  const zs = (z: [number, number, number, number, number]) => summary({ hr: { ...summary().hr, hasData: true, zoneSeconds: z } });
  it("zone shaping", () => {
    const z = zoneData(zs([600, 1200, 0, 0, 0]));
    expect(z[0]).toEqual({ name: "Zone 1", minutes: 10, pct: 33 });
    expect(z[1]?.pct).toBe(67);
    expect(zoneSummaryText(zs([600, 1200, 0, 0, 0]))).toBe("Most time in Zone 2: 20 minutes (67%).");
  });
  it("zone NaN safe", () => {
    expect(zoneData(zs([NaN, Infinity, -5, 0, 0])).every((z) => z.pct === 0)).toBe(true);
  });
  it("null hr points stay null", () => {
    expect(hrData(summary({ hr: { ...summary().hr, series: [{ date: "2026-10-30", avgHr: null, maxHr: NaN }] } }))[0]).toMatchObject({ avgHr: null, maxHr: null });
  });
});

describe("createRequestGuard", () => {
  it("only the latest request is current", () => {
    const g = createRequestGuard();
    const a = g.next();
    const b = g.next();
    expect(g.isCurrent(a)).toBe(false);
    expect(g.isCurrent(b)).toBe(true);
  });
});
