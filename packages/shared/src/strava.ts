/** Phase 2 Strava helpers. Pure TypeScript: runs in the browser and in the Worker. */
import { hrZones, metForIntensity, metKcal } from "./calc";
import type { StravaActivityUpsert, StravaDetailedActivity, StravaHrStream } from "./stravaTypes";
import type { ActivitySource, Intensity } from "./types";

export function isTokenExpiring(expiresAtSec: number, nowSec: number, skewSec = 300): boolean {
  return expiresAtSec - nowSec <= skewSec;
}

const SPORT_MAP: Record<string, string> = {
  Walk: "Walking",
  Hike: "Walking",
  Run: "Running",
  TrailRun: "Running",
  VirtualRun: "Running",
  Ride: "Cycling",
  VirtualRide: "Cycling",
  MountainBikeRide: "Cycling",
  GravelRide: "Cycling",
  EBikeRide: "Cycling",
  Swim: "Swimming",
  Yoga: "Yoga",
  WeightTraining: "Gym / Strength training",
  Workout: "Gym / Strength training",
  Crossfit: "Gym / Strength training",
  HighIntensityIntervalTraining: "HIIT",
  Badminton: "Badminton",
  Tennis: "Tennis",
  Soccer: "Football",
  StairStepper: "Stair climbing",
  JumpRope: "Skipping",
  Cricket: "Cricket",
};

export function mapStravaSport(sportType: string): { typeName: string; custom: string | null } {
  const s = typeof sportType === "string" ? sportType.trim() : "";
  if (!s) return { typeName: "Other", custom: "Workout" };
  if (Object.prototype.hasOwnProperty.call(SPORT_MAP, s)) {
    return { typeName: SPORT_MAP[s], custom: null };
  }
  const words = s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\s]+/g, " ")
    .trim();
  return { typeName: "Other", custom: words || "Workout" };
}

export function intensityFromHr(avgHr: number | null, maxHr: number | null): Intensity {
  if (
    avgHr == null ||
    maxHr == null ||
    !Number.isFinite(avgHr) ||
    !Number.isFinite(maxHr) ||
    avgHr <= 0 ||
    maxHr <= 0
  ) {
    return "moderate";
  }
  const pct = avgHr / maxHr;
  if (pct < 0.6) return "light";
  if (pct < 0.8) return "moderate";
  return "vigorous";
}

const MAX_SAMPLE_GAP_S = 30;

export function timeInHrZones(
  stream: StravaHrStream,
  maxHr: number,
): [number, number, number, number, number] {
  const out: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  const time = stream?.time ?? [];
  const hr = stream?.heartrate ?? [];
  const n = Math.min(time.length, hr.length);
  if (n === 0 || !(maxHr > 0)) return out;
  const zones = hrZones(maxHr);
  let prevDelta = 0;
  for (let i = 0; i < n; i++) {
    let delta: number;
    if (i < n - 1) {
      delta = time[i + 1] - time[i];
      prevDelta = delta;
    } else {
      delta = prevDelta;
    }
    const h = hr[i];
    if (!Number.isFinite(h) || h <= 0) continue;
    if (!Number.isFinite(delta) || delta <= 0) continue;
    const d = Math.min(delta, MAX_SAMPLE_GAP_S);
    let idx = 4;
    for (let z = 0; z < 5; z++) {
      if (h <= zones[z].maxBpm) {
        idx = z;
        break;
      }
    }
    out[idx] += d;
  }
  return out;
}

export interface StravaBuildContext {
  userId: string;
  typeIdByName: Record<string, number>;
  metByTypeId: Record<number, { met_light: number; met_moderate: number; met_vigorous: number }>;
  weightKg: number | null;
  maxHr: number | null;
  id: string;
}

function hrOrNull(v: number | undefined | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const r = Math.round(v);
  return r >= 40 && r <= 220 ? r : null;
}

function numOrNull(v: number | undefined | null): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

export function buildActivityFromStrava(
  d: StravaDetailedActivity,
  ctx: StravaBuildContext,
): StravaActivityUpsert {
  const sport = mapStravaSport(d.sport_type || d.type);
  const mappedId = ctx.typeIdByName[sport.typeName];
  const typeId = mappedId ?? ctx.typeIdByName["Other"];
  const isOther = sport.typeName === "Other" || mappedId === undefined;

  const moving = Number.isFinite(d.moving_time) && d.moving_time > 0 ? d.moving_time : 0;
  const elapsed = Number.isFinite(d.elapsed_time) && d.elapsed_time > 0 ? d.elapsed_time : 0;
  const durationSec = moving > 0 ? moving : elapsed;
  const durationMin = Math.max(1, Math.round(durationSec / 60));

  const avgHr = hrOrNull(d.average_heartrate);
  const maxHr = hrOrNull(d.max_heartrate);
  const intensity = intensityFromHr(avgHr, ctx.maxHr);

  const distKm =
    Number.isFinite(d.distance) && d.distance > 0 ? Math.round((d.distance / 1000) * 100) / 100 : null;

  let calories: number | null;
  let estimated: boolean;
  if (typeof d.calories === "number" && Number.isFinite(d.calories) && d.calories > 0) {
    calories = Math.round(d.calories);
    estimated = false;
  } else {
    estimated = true;
    const met = ctx.metByTypeId[typeId];
    if (ctx.weightKg != null && Number.isFinite(ctx.weightKg) && ctx.weightKg > 0 && met) {
      calories = metKcal({
        met: metForIntensity(met, intensity),
        weightKg: ctx.weightKg,
        durationMin,
      });
    } else {
      calories = null;
    }
  }

  return {
    id: ctx.id,
    user_id: ctx.userId,
    source: "strava",
    strava_id: d.id,
    activity_type_id: typeId,
    custom_name: isOther ? (sport.custom ?? "Workout") : null,
    name: d.name,
    start_time: new Date(d.start_date).toISOString(),
    duration_min: durationMin,
    distance_km: distKm,
    steps: null,
    intensity,
    avg_hr: avgHr,
    max_hr: maxHr,
    calories,
    calories_estimated: estimated,
    elevation_m: numOrNull(d.total_elevation_gain),
    suffer_score: numOrNull(d.suffer_score),
    moving_time_s: Math.round(moving),
    elapsed_time_s: Math.round(elapsed),
  };
}

export function findDuplicateCandidates(
  target: { id: string; activity_type_id: number; start_time: string; source?: ActivitySource },
  others: Array<{ id: string; activity_type_id: number; start_time: string; source: ActivitySource }>,
  windowMin = 30,
): string[] {
  const t = Date.parse(target.start_time);
  if (!Number.isFinite(t)) return [];
  const windowMs = windowMin * 60_000;
  return others
    .filter((o) => o.id !== target.id && o.activity_type_id === target.activity_type_id)
    .filter((o) => target.source === undefined || o.source !== target.source)
    .map((o) => ({ id: o.id, diff: Math.abs(Date.parse(o.start_time) - t) }))
    .filter((x) => Number.isFinite(x.diff) && x.diff <= windowMs)
    .sort((a, b) => a.diff - b.diff)
    .map((x) => x.id);
}

function parsePair(v: string | null | undefined): [number, number] | null {
  if (!v) return null;
  const parts = v.split(",").map((p) => Number(p.trim()));
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  return [parts[0], parts[1]];
}

export function retryAfterSeconds(
  headers: { retryAfter?: string | null; usage?: string | null; limit?: string | null },
  nowSec: number = Math.floor(Date.now() / 1000),
): number {
  const ra = headers.retryAfter != null ? Number(String(headers.retryAfter).trim()) : NaN;
  if (Number.isInteger(ra) && ra > 0) return ra;
  const now = Number.isFinite(nowSec) ? Math.floor(nowSec) : Math.floor(Date.now() / 1000);
  const usage = parsePair(headers.usage);
  const limit = parsePair(headers.limit);
  if (usage && limit) {
    // Daily limit wins when both are exhausted: the next 15-minute window would not help.
    if (usage[1] >= limit[1]) return Math.max(1, 86400 - (((now % 86400) + 86400) % 86400));
    if (usage[0] >= limit[0]) return Math.max(1, 900 - (((now % 900) + 900) % 900));
  }
  return 60;
}
