import { describe, expect, it } from "vitest";
import type { ActivityRow, ActivityTypeRow } from "@/lib/database.types";
import {
  buildActivityRow, cloneForRepeat, daySummary, emptyForm, estimateKcal, groupByIstDate, rowToForm,
  templateFromForm, templateFromRow, templateToPrefill, validateForm, type ActivityFormValues,
} from "./logic";

const types: ActivityTypeRow[] = [
  { id: 3, name: "Running", met_light: 7, met_moderate: 9.8, met_vigorous: 11.5, has_distance: true, sort_order: 3 },
  { id: 18, name: "Other", met_light: 3, met_moderate: 4, met_vigorous: 6, has_distance: false, sort_order: 18 },
];
const TODAY = "2026-03-10";
const base = (o: Partial<ActivityFormValues> = {}): ActivityFormValues => ({
  ...emptyForm(new Date("2026-03-10T04:00:00Z")), typeId: 3, date: TODAY, time: "06:30", duration: "00:30", ...o,
});
const errs = (o: Partial<ActivityFormValues>) => validateForm(base(o), types, TODAY);

describe("validateForm", () => {
  it("rejects a start time later than now on the same IST day", () => {
    // 2026-03-10 06:30 IST = 01:00Z. "now" is 06:00 IST, so 06:30 is in the future and 05:59 is not.
    const now = new Date("2026-03-10T00:30:00Z");
    expect(validateForm(base({ time: "06:30" }), types, TODAY, now).time).toMatch(/future/);
    expect(validateForm(base({ time: "05:59" }), types, TODAY, now).time).toBeUndefined();
  });
  it("accepts a valid form", () => expect(errs({})).toEqual({}));
  it.each([["00:00", true], ["00:01", false], ["10:00", false], ["10:01", true]])("duration %s error=%s", (d, bad) => {
    expect(!!errs({ duration: d }).duration).toBe(bad);
  });
  it("requires duration and format", () => {
    expect(errs({ duration: "" }).duration).toMatch(/required/);
    expect(errs({ duration: "abc" }).duration).toBeTruthy();
    expect(errs({ duration: "1:75" }).duration).toBeTruthy();
  });
  it.each([["39", true], ["40", false], ["220", false], ["221", true]])("HR %s error=%s", (h, bad) => {
    expect(!!errs({ avgHr: h }).avgHr).toBe(bad);
    expect(!!errs({ maxHr: h }).maxHr).toBe(bad);
  });
  it("avg above max is an error, equal is fine", () => {
    expect(errs({ avgHr: "150", maxHr: "140" }).avgHr).toMatch(/above max/);
    expect(errs({ avgHr: "140", maxHr: "140" })).toEqual({});
  });
  it("Other needs a name, others do not", () => {
    expect(errs({ typeId: 18, customName: "  " }).customName).toBeTruthy();
    expect(errs({ typeId: 18, customName: "Kabaddi" }).customName).toBeUndefined();
    expect(errs({ typeId: 3, customName: "" }).customName).toBeUndefined();
  });
  it("rejects future date, allows today", () => {
    expect(errs({ date: "2026-03-11" }).date).toMatch(/future/);
    expect(errs({ date: TODAY }).date).toBeUndefined();
  });
  it("requires a type and rejects negatives", () => {
    expect(errs({ typeId: null }).typeId).toBeTruthy();
    expect(errs({ distance: "-1" }).distance).toBeTruthy();
    expect(errs({ calories: "-5" }).calories).toBeTruthy();
    expect(errs({ steps: "1.5" }).steps).toBeTruthy();
  });
});

describe("estimateKcal", () => {
  it("MET x kg x h", () => expect(estimateKcal(types[0], "moderate", 70, 60)).toBe(686));
  it("null without weight or duration", () => {
    expect(estimateKcal(types[0], "moderate", null, 60)).toBeNull();
    expect(estimateKcal(types[0], "moderate", 70, 0)).toBeNull();
  });
  it("uses intensity", () => expect(estimateKcal(types[0], "light", 70, 60)).toBe(490));
});

describe("buildActivityRow", () => {
  const ctx = { id: "a1", userId: "u1", weightKg: 70 };
  it("converts IST to UTC at the day boundary", () => {
    expect(buildActivityRow(base({ time: "00:10" }), types, ctx)!.start_time).toBe("2026-03-09T18:40:00.000Z");
    expect(buildActivityRow(base({ time: "23:59" }), types, ctx)!.start_time).toBe("2026-03-10T18:29:00.000Z");
  });
  it("estimates when calories blank", () => {
    const r = buildActivityRow(base({ duration: "01:00" }), types, ctx)!;
    expect(r.calories).toBe(686);
    expect(r.calories_estimated).toBe(true);
  });
  it("keeps entered calories as not estimated", () => {
    const r = buildActivityRow(base({ calories: "300" }), types, ctx)!;
    expect(r.calories).toBe(300);
    expect(r.calories_estimated).toBe(false);
  });
  it("no weight and no calories: null, not estimated", () => {
    const r = buildActivityRow(base(), types, { ...ctx, weightKg: null })!;
    expect(r.calories).toBeNull();
    expect(r.calories_estimated).toBe(false);
  });
  it("custom_name only for Other", () => {
    expect(buildActivityRow(base({ customName: "x" }), types, ctx)!.custom_name).toBeNull();
    expect(buildActivityRow(base({ typeId: 18, customName: " Kabaddi " }), types, ctx)!.custom_name).toBe("Kabaddi");
  });
  it("parses numbers and nulls blanks", () => {
    const r = buildActivityRow(base({ distance: "5.2", steps: "6000", avgHr: "130", maxHr: "160", notes: " hi " }), types, ctx)!;
    expect(r).toMatchObject({ distance_km: 5.2, steps: 6000, avg_hr: 130, max_hr: 160, notes: "hi", duration_min: 30, source: "manual" });
    expect(buildActivityRow(base(), types, ctx)).toMatchObject({ distance_km: null, steps: null, avg_hr: null, notes: null });
  });
  it("unknown type gives null", () => expect(buildActivityRow(base({ typeId: 99 }), types, ctx)).toBeNull());
});

const row = (o: Partial<ActivityRow> = {}): ActivityRow => ({
  id: "r1", user_id: "u1", source: "strava", strava_id: 55, activity_type_id: 3, custom_name: null,
  start_time: "2026-03-09T20:00:00.000Z", duration_min: 45, distance_km: 5, steps: null, intensity: "vigorous",
  avg_hr: 150, max_hr: 170, calories: 400, calories_estimated: true, notes: "n", duplicate_of: "z",
  created_at: "", updated_at: "", ...o,
});

describe("cloning", () => {
  it("repeat gets new id, now, manual, no strava link", () => {
    const c = cloneForRepeat(row(), { id: "new", now: new Date("2026-03-10T05:07:42.500Z") });
    expect(c).toMatchObject({ id: "new", source: "manual", strava_id: null, duplicate_of: null, start_time: "2026-03-10T05:07:00.000Z", duration_min: 45, intensity: "vigorous", calories: 400 });
  });
  it("template from row/form and back to prefill", () => {
    expect(templateFromRow(row({ custom_name: "Kabaddi" }), types, { id: "t" })).toMatchObject({ id: "t", name: "Kabaddi", duration_min: 45, intensity: "vigorous" });
    expect(templateFromRow(row(), types, { id: "t" }).name).toBe("Running");
    const t = templateFromForm(base({ duration: "00:20" }), types, { id: "t", userId: "u1" })!;
    expect(t).toMatchObject({ name: "Running", duration_min: 20, user_id: "u1" });
    expect(templateFromForm(base({ duration: "" }), types, { id: "t", userId: "u1" })).toBeNull();
    const p = templateToPrefill({ ...t, created_at: "" }, new Date("2026-03-10T04:00:00Z"));
    expect(p).toMatchObject({ typeId: 3, duration: "00:20", intensity: "moderate", date: "2026-03-10" });
  });
  it("rowToForm blanks estimated calories and shows IST", () => {
    const f = rowToForm(row());
    expect(f).toMatchObject({ date: "2026-03-10", time: "01:30", duration: "00:45", calories: "" });
    expect(rowToForm(row({ calories_estimated: false })).calories).toBe("400");
  });
});

describe("grouping and summary", () => {
  const rows = [
    row({ id: "a", start_time: "2026-03-09T18:20:00.000Z" }), // 23:50 IST on 9th
    row({ id: "b", start_time: "2026-03-09T18:40:00.000Z" }), // 00:10 IST on 10th
    row({ id: "c", start_time: "2026-03-10T02:00:00.000Z" }),
    row({ id: "d", start_time: "2026-03-01T02:00:00.000Z" }),
  ];
  it("groups by IST date, newest first", () => {
    const g = groupByIstDate(rows);
    expect(g.map((x) => x.date)).toEqual(["2026-03-10", "2026-03-09", "2026-03-01"]);
    expect(g[0].items.map((i) => i.id)).toEqual(["c", "b"]);
    expect(g[1].items.map((i) => i.id)).toEqual(["a"]);
  });
  it("empty input", () => expect(groupByIstDate([])).toEqual([]));
  it("summary", () => {
    expect(daySummary([row(), row({ calories: null, calories_estimated: false, duration_min: 15 })])).toEqual({ minutes: 60, kcal: 400, anyEstimated: true });
    expect(daySummary([])).toEqual({ minutes: 0, kcal: 0, anyEstimated: false });
  });
});
