/** Activity file import (GPX / TCX) types. Part of the import contract (frozen). */
import type { Intensity } from "./types";
import type { StravaHrStream } from "./stravaTypes";

export type ActivityFileFormat = "gpx" | "tcx";

/** One workout found in a file (a GPX <trk> or a TCX <Activity>). All maths is already done; GPS points are discarded. */
export interface ParsedWorkout {
  format: ActivityFileFormat;
  /** name from the file, if any */
  name: string | null;
  /** raw sport text from the file, e.g. "running", "Biking", "walking", or null */
  sportHint: string | null;
  /** ISO UTC of the first timestamp */
  startTime: string;
  /** last timestamp minus first, in seconds */
  elapsedSec: number;
  /** elapsed minus long pauses (gaps over 30 s between points), null when it cannot be told */
  movingSec: number | null;
  /** from the file's totals when present, else summed from points; null when there is no distance data */
  distanceKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** calories reported by the file (TCX), else null */
  calories: number | null;
  elevationGainM: number | null;
  /** heart-rate samples (seconds from start, bpm), valid samples only (40..220); null when the file has none */
  hr: StravaHrStream | null;
  /** true when timestamps had no UTC marker or offset and the `assumeTz` option was applied */
  timeWasAssumed: boolean;
  /** non-fatal notes, e.g. "Some heart-rate readings were ignored." */
  warnings: string[];
}

export type ParseResult = { ok: true; workouts: ParsedWorkout[] } | { ok: false; error: string };

export interface ParseOptions {
  fileName?: string;
  /** how to read timestamps that carry no Z or offset; default "utc" */
  assumeTz?: "utc" | "ist";
}

/** Row inserted into `activities` for an imported workout (source is always "manual"). */
export interface ImportActivityUpsert {
  id: string;
  user_id: string;
  source: "manual";
  activity_type_id: number;
  custom_name: string | null;
  start_time: string;
  duration_min: number;
  distance_km: number | null;
  intensity: Intensity;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  calories_estimated: boolean;
  notes: string;
}
