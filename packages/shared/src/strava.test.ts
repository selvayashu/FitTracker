import { describe, expect, it } from "vitest";
import {
  buildActivityFromStrava,
  findDuplicateCandidates,
  intensityFromHr,
  isTokenExpiring,
  mapStravaSport,
  retryAfterSeconds,
  timeInHrZones,
} from "./strava";
import type { StravaDetailedActivity } from "./stravaTypes";

describe("isTokenExpiring", () => {
  it("applies the 300 s skew edges", () => {
    const now = 1000;
    expect(isTokenExpiring(now + 299, now)).toBe(true);
    expect(isTokenExpiring(now + 300, now)).toBe(true);
    expect(isTokenExpiring(now + 301, now)).toBe(false);
  });
  it("treats already expired as expiring and honours a custom skew", () => {
    expect(isTokenExpiring(500, 1000)).toBe(true);
    expect(isTokenExpiring(1010, 1000, 10)).toBe(true);
    expect(isTokenExpiring(1011, 1000, 10)).toBe(false);
  });
});

describe("mapStravaSport", () => {
  const cases: Array<[string, string]> = [
    ["Walk", "Walking"],
    ["Hike", "Walking"],
    ["Run", "Running"],
    ["TrailRun", "Running"],
    ["VirtualRun", "Running"],
    ["Ride", "Cycling"],
    ["VirtualRide", "Cycling"],
    ["MountainBikeRide", "Cycling"],
    ["GravelRide", "Cycling"],
    ["EBikeRide", "Cycling"],
    ["Swim", "Swimming"],
    ["Yoga", "Yoga"],
    ["WeightTraining", "Gym / Strength training"],
    ["Workout", "Gym / Strength training"],
    ["Crossfit", "Gym / Strength training"],
    ["HighIntensityIntervalTraining", "HIIT"],
    ["Badminton", "Badminton"],
    ["Tennis", "Tennis"],
    ["Soccer", "Football"],
    ["StairStepper", "Stair climbing"],
    ["JumpRope", "Skipping"],
    ["Cricket", "Cricket"],
  ];
  it.each(cases)("%s -> %s with null custom", (sport, name) => {
    expect(mapStravaSport(sport)).toEqual({ typeName: name, custom: null });
  });
  it("unknown types become Other with a split CamelCase name", () => {
    expect(mapStravaSport("StandUpPaddling")).toEqual({
      typeName: "Other",
      custom: "Stand Up Paddling",
    });
    expect(mapStravaSport("Kayaking")).toEqual({ typeName: "Other", custom: "Kayaking" });
  });
  it("is case sensitive", () => {
    expect(mapStravaSport("run").typeName).toBe("Other");
    expect(mapStravaSport("run").custom).toBe("run");
  });
  it("tolerates empty and undefined", () => {
    expect(mapStravaSport("")).toEqual({ typeName: "Other", custom: "Workout" });
    expect(mapStravaSport(undefined as unknown as string)).toEqual({
      typeName: "Other",
      custom: "Workout",
    });
  });
});

describe("intensityFromHr", () => {
  it("has exact boundaries at 60% and 80%", () => {
    expect(intensityFromHr(119, 200)).toBe("light");
    expect(intensityFromHr(120, 200)).toBe("moderate");
    expect(intensityFromHr(159, 200)).toBe("moderate");
    expect(intensityFromHr(160, 200)).toBe("vigorous");
    expect(intensityFromHr(200, 200)).toBe("vigorous");
  });
  it("defaults to moderate for missing or invalid data", () => {
    expect(intensityFromHr(null, 190)).toBe("moderate");
    expect(intensityFromHr(140, null)).toBe("moderate");
    expect(intensityFromHr(140, 0)).toBe("moderate");
    expect(intensityFromHr(NaN, 190)).toBe("moderate");
    expect(intensityFromHr(0, 190)).toBe("moderate");
  });
});

describe("timeInHrZones", () => {
  // maxHr 190 -> hrZones: z1 95-114, z2 115-133, z3 134-152, z4 153-171, z5 172-190.
  it("attributes sample time by delta to the next sample", () => {
    // t:   0   10  20  30  100 110
    // hr: 100 120 140 160 180   0
    // i0 100 -> z1, delta 10 -> z1 += 10
    // i1 120 -> z2, delta 10 -> z2 += 10
    // i2 140 -> z3, delta 10 -> z3 += 10
    // i3 160 -> z4, delta 70, capped to 30 -> z4 += 30
    // i4 180 -> z5, delta 10 -> z5 += 10
    // i5 0 -> ignored (bad hr)
    const r = timeInHrZones(
      { time: [0, 10, 20, 30, 100, 110], heartrate: [100, 120, 140, 160, 180, 0] },
      190,
    );
    expect(r).toEqual([10, 10, 10, 30, 10]);
  });
  it("gives the last sample the previous delta", () => {
    expect(timeInHrZones({ time: [0, 5, 10], heartrate: [100, 100, 100] }, 190)).toEqual([
      15, 0, 0, 0, 0,
    ]);
  });
  it("single sample counts nothing", () => {
    expect(timeInHrZones({ time: [0], heartrate: [150] }, 190)).toEqual([0, 0, 0, 0, 0]);
  });
  it("below zone 1 counts as zone 1 and above max as zone 5", () => {
    expect(timeInHrZones({ time: [0, 10, 20], heartrate: [60, 200, 200] }, 190)).toEqual([
      10, 0, 0, 0, 20,
    ]);
  });
  it("zone edges are inclusive of maxBpm", () => {
    const r = timeInHrZones({ time: [0, 1, 2, 3], heartrate: [114, 115, 171, 172] }, 190);
    expect(r).toEqual([1, 1, 0, 1, 1]);
  });
  it("ignores non-finite and non-positive hr, and non-positive deltas", () => {
    const r = timeInHrZones(
      { time: [0, 10, 20, 20, 30], heartrate: [NaN, 100, -5, 100, 100] },
      190,
    );
    // i0 NaN skip; i1 100 delta 10 -> z1 10; i2 -5 skip; i3 delta 10 -> z1 10; i4 last prev delta 10 -> z1 10
    expect(r).toEqual([30, 0, 0, 0, 0]);
  });
  it("uses the shorter array and handles empty", () => {
    expect(timeInHrZones({ time: [0, 10, 20, 30], heartrate: [100, 100] }, 190)).toEqual([
      20, 0, 0, 0, 0,
    ]);
    expect(timeInHrZones({ time: [], heartrate: [] }, 190)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("findDuplicateCandidates", () => {
  const target = { id: "t", activity_type_id: 3, start_time: "2026-03-10T10:00:00Z" };
  const mk = (id: string, start: string, type = 3, source: "strava" | "manual" = "manual") => ({
    id,
    activity_type_id: type,
    start_time: start,
    source,
  });
  it("includes exactly 30 min and excludes 31 min, sorted by closeness", () => {
    const res = findDuplicateCandidates(target, [
      mk("a", "2026-03-10T10:30:00Z"),
      mk("b", "2026-03-10T10:31:00Z"),
      mk("c", "2026-03-10T09:50:00Z"),
      mk("d", "2026-03-10T09:30:00Z"),
      mk("e", "2026-03-10T09:29:00Z"),
    ]);
    expect(res).toEqual(["c", "a", "d"]);
  });
  it("excludes other types and the same id", () => {
    expect(
      findDuplicateCandidates(target, [
        mk("x", "2026-03-10T10:00:00Z", 4),
        mk("t", "2026-03-10T10:00:00Z"),
      ]),
    ).toEqual([]);
  });
  it("filters same-source others only when target.source is given", () => {
    const others = [
      mk("m", "2026-03-10T10:05:00Z", 3, "manual"),
      mk("s", "2026-03-10T10:06:00Z", 3, "strava"),
    ];
    expect(findDuplicateCandidates({ ...target, source: "strava" }, others)).toEqual(["m"]);
    expect(findDuplicateCandidates({ ...target, source: "manual" }, others)).toEqual(["s"]);
    expect(findDuplicateCandidates(target, others)).toEqual(["m", "s"]);
  });
  it("supports a custom window", () => {
    expect(findDuplicateCandidates(target, [mk("a", "2026-03-10T10:10:00Z")], 5)).toEqual([]);
    expect(findDuplicateCandidates(target, [mk("a", "2026-03-10T10:05:00Z")], 5)).toEqual(["a"]);
  });
});

describe("buildActivityFromStrava", () => {
  const ctx = {
    userId: "u1",
    id: "act-1",
    typeIdByName: { Walking: 1, Running: 3, Other: 18 } as Record<string, number>,
    metByTypeId: {
      1: { met_light: 2.8, met_moderate: 3.5, met_vigorous: 4.3 },
      3: { met_light: 7, met_moderate: 9.8, met_vigorous: 11.5 },
      18: { met_light: 3, met_moderate: 4, met_vigorous: 6 },
    },
    weightKg: 70 as number | null,
    maxHr: 190 as number | null,
  };
  const base: StravaDetailedActivity = {
    id: 999,
    name: "Morning Run",
    type: "Run",
    sport_type: "Run",
    start_date: "2026-03-10T01:00:00Z",
    moving_time: 1800,
    elapsed_time: 2000,
    distance: 5004,
    total_elevation_gain: 42.5,
    average_heartrate: 150,
    max_heartrate: 175,
    suffer_score: 33,
  };

  it("uses Strava calories when provided", () => {
    const r = buildActivityFromStrava({ ...base, calories: 321.4 }, ctx);
    expect(r.calories).toBe(321);
    expect(r.calories_estimated).toBe(false);
    expect(r).toMatchObject({
      id: "act-1",
      user_id: "u1",
      source: "strava",
      strava_id: 999,
      activity_type_id: 3,
      custom_name: null,
      name: "Morning Run",
      start_time: "2026-03-10T01:00:00.000Z",
      duration_min: 30,
      distance_km: 5,
      steps: null,
      avg_hr: 150,
      max_hr: 175,
      elevation_m: 42.5,
      suffer_score: 33,
      moving_time_s: 1800,
      elapsed_time_s: 2000,
    });
  });

  it("falls back to a MET estimate", () => {
    // 150/190 = 78.9% -> moderate -> MET 9.8; 9.8 * 70 kg * 30 min / 60 = 343
    const r = buildActivityFromStrava(base, ctx);
    expect(r.intensity).toBe("moderate");
    expect(r.calories).toBe(343);
    expect(r.calories_estimated).toBe(true);
  });

  it("treats zero calories as missing", () => {
    expect(buildActivityFromStrava({ ...base, calories: 0 }, ctx).calories_estimated).toBe(true);
  });

  it("gives null calories (estimated) with no valid weight", () => {
    for (const w of [null, 0, NaN]) {
      const r = buildActivityFromStrava(base, { ...ctx, weightKg: w });
      expect(r.calories).toBeNull();
      expect(r.calories_estimated).toBe(true);
    }
  });

  it("falls back to elapsed time and clamps to 1 minute", () => {
    expect(buildActivityFromStrava({ ...base, moving_time: 0 }, ctx)).toMatchObject({
      duration_min: 33,
      moving_time_s: 0,
      elapsed_time_s: 2000,
    });
    expect(
      buildActivityFromStrava({ ...base, moving_time: 10, elapsed_time: 10 }, ctx).duration_min,
    ).toBe(1);
  });

  it("nulls heart rates outside 40..220", () => {
    const r = buildActivityFromStrava({ ...base, average_heartrate: 30, max_heartrate: 250 }, ctx);
    expect(r.avg_hr).toBeNull();
    expect(r.max_hr).toBeNull();
    expect(r.intensity).toBe("moderate");
    const edge = buildActivityFromStrava({ ...base, average_heartrate: 40, max_heartrate: 220 }, ctx);
    expect(edge.avg_hr).toBe(40);
    expect(edge.max_hr).toBe(220);
  });

  it("nulls distance of 0 and missing optional fields", () => {
    const r = buildActivityFromStrava(
      {
        ...base,
        distance: 0,
        total_elevation_gain: undefined,
        suffer_score: undefined,
        average_heartrate: undefined,
        max_heartrate: undefined,
      },
      ctx,
    );
    expect(r.distance_km).toBeNull();
    expect(r.elevation_m).toBeNull();
    expect(r.suffer_score).toBeNull();
    expect(r.avg_hr).toBeNull();
  });

  it("rounds distance to 2 decimals", () => {
    expect(buildActivityFromStrava({ ...base, distance: 1234.5 }, ctx).distance_km).toBe(1.23);
  });

  it("maps unknown sports to Other with a custom name", () => {
    const r = buildActivityFromStrava(
      { ...base, type: "Foo", sport_type: "StandUpPaddling", calories: 100 },
      ctx,
    );
    expect(r.activity_type_id).toBe(18);
    expect(r.custom_name).toBe("Stand Up Paddling");
  });

  it("falls back to type when sport_type is absent", () => {
    const r = buildActivityFromStrava({ ...base, sport_type: undefined, type: "Walk" }, ctx);
    expect(r.activity_type_id).toBe(1);
  });

  it("never contains notes, excluded or duplicate_dismissed", () => {
    const keys = Object.keys(buildActivityFromStrava(base, ctx));
    expect(keys).not.toContain("notes");
    expect(keys).not.toContain("excluded");
    expect(keys).not.toContain("duplicate_dismissed");
  });
});

describe("retryAfterSeconds", () => {
  it("uses a positive integer Retry-After", () => {
    expect(retryAfterSeconds({ retryAfter: "42" }, 0)).toBe(42);
  });
  it("ignores a bad Retry-After", () => {
    expect(retryAfterSeconds({ retryAfter: "0" }, 0)).toBe(60);
    expect(retryAfterSeconds({ retryAfter: "-3" }, 0)).toBe(60);
    expect(retryAfterSeconds({ retryAfter: "abc" }, 0)).toBe(60);
    expect(retryAfterSeconds({ retryAfter: "1.5" }, 0)).toBe(60);
  });
  it("waits for the next 15-minute boundary when the short window is full", () => {
    // 900100 % 900 = 100 -> 800 s to the boundary
    expect(retryAfterSeconds({ usage: "100,600", limit: "100,1000" }, 900100)).toBe(800);
    expect(retryAfterSeconds({ usage: "98,600", limit: "100,1000" }, 900100)).toBe(60);
    // exactly on a boundary -> full 900 s
    expect(retryAfterSeconds({ usage: "101,600", limit: "100,1000" }, 900000)).toBe(900);
    // one second before the boundary -> minimum 1
    expect(retryAfterSeconds({ usage: "100,600", limit: "100,1000" }, 900899)).toBe(1);
  });
  it("waits until UTC midnight when the daily limit is hit", () => {
    // 10 days + 80000 s -> 86400 - 80000 = 6400 s left
    expect(retryAfterSeconds({ usage: "10,1000", limit: "100,1000" }, 864000 + 80000)).toBe(6400);
  });
  it("returns 60 for garbage or missing input and never NaN or < 1", () => {
    expect(retryAfterSeconds({}, 0)).toBe(60);
    expect(retryAfterSeconds({ usage: "x", limit: "y" }, 0)).toBe(60);
    expect(retryAfterSeconds({ usage: "1", limit: "2" }, 0)).toBe(60);
    expect(retryAfterSeconds({ usage: null, limit: null, retryAfter: null }, NaN)).toBe(60);
    const r = retryAfterSeconds({ usage: "100,1000", limit: "100,1000" }, 86399);
    expect(r).toBeGreaterThanOrEqual(1);
  });
});
