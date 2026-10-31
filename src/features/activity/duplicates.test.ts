import { describe, expect, it } from "vitest";
import type { ActivityRow } from "@/lib/database.types";
import { findOther, missingOtherIds, needsReview, planDuplicateAction } from "./duplicates";

const row = (o: Partial<ActivityRow>): ActivityRow => ({
  id: "s1", user_id: "u", source: "strava", strava_id: 1, activity_type_id: 3, custom_name: null, start_time: "2026-03-10T01:00:00Z",
  duration_min: 30, distance_km: null, steps: null, intensity: "moderate", avg_hr: null, max_hr: null, calories: null,
  calories_estimated: false, notes: null, duplicate_of: "m1", name: null, elevation_m: null, suffer_score: null,
  moving_time_s: null, elapsed_time_s: null, excluded: false, duplicate_dismissed: false, created_at: "", updated_at: "", ...o,
});

describe("needsReview", () => {
  it("flags strava rows with an undismissed duplicate", () => expect(needsReview(row({}))).toBe(true));
  it("ignores dismissed, excluded, unlinked and manual rows", () => {
    expect(needsReview(row({ duplicate_dismissed: true }))).toBe(false);
    expect(needsReview(row({ excluded: true }))).toBe(false);
    expect(needsReview(row({ duplicate_of: null }))).toBe(false);
    expect(needsReview(row({ source: "manual" }))).toBe(false);
  });
});

describe("findOther / missingOtherIds", () => {
  const manual = row({ id: "m1", source: "manual", strava_id: null, duplicate_of: null });
  it("finds the other row among loaded rows", () => {
    expect(findOther(row({}), [manual])?.id).toBe("m1");
    expect(findOther(row({}), [])).toBeNull();
    expect(findOther(row({ duplicate_of: null }), [manual])).toBeNull();
  });
  it("lists only absent ids, once", () => {
    expect(missingOtherIds([row({}), row({ id: "s2" })])).toEqual(["m1"]);
    expect(missingOtherIds([row({}), manual])).toEqual([]);
    expect(missingOtherIds([row({ duplicate_dismissed: true })])).toEqual([]);
  });
});

describe("planDuplicateAction", () => {
  it("keep strava deletes the manual row", () =>
    expect(planDuplicateAction("keep_strava", row({}))).toEqual({ deleteId: "m1", update: null }));
  it("keep manual hides the strava row", () =>
    expect(planDuplicateAction("keep_manual", row({}))).toEqual({ deleteId: null, update: { id: "s1", patch: { excluded: true } } }));
  it("not a duplicate dismisses", () =>
    expect(planDuplicateAction("not_duplicate", row({}))).toEqual({ deleteId: null, update: { id: "s1", patch: { duplicate_dismissed: true } } }));
});
