/** Strava-related types shared by the Worker, the shared module and the app. Part of the Phase 2 contract (frozen). */
import type { Intensity } from "./types";

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  /** Unix seconds */
  expires_at: number;
  athlete?: { id: number };
}

export interface StravaDetailedActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  /** ISO UTC, e.g. 2026-03-10T01:00:00Z */
  start_date: string;
  moving_time: number;
  elapsed_time: number;
  /** metres */
  distance: number;
  total_elevation_gain?: number;
  calories?: number;
  has_heartrate?: boolean;
  average_heartrate?: number;
  max_heartrate?: number;
  suffer_score?: number;
}

export interface StravaHrStream {
  /** seconds from start, same length as heartrate */
  time: number[];
  heartrate: number[];
}

/** Row written to `activities` for a Strava activity. Never contains notes, excluded or duplicate_dismissed. */
export interface StravaActivityUpsert {
  id: string;
  user_id: string;
  source: "strava";
  strava_id: number;
  activity_type_id: number;
  custom_name: string | null;
  name: string;
  start_time: string;
  duration_min: number;
  distance_km: number | null;
  steps: null;
  intensity: Intensity;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  calories_estimated: boolean;
  elevation_m: number | null;
  suffer_score: number | null;
  moving_time_s: number;
  elapsed_time_s: number;
}

export interface StravaStatus {
  connected: boolean;
  athlete_id: number | null;
  last_sync_at: string | null;
  scope: string | null;
}

export interface SyncResult {
  /** True when the whole window has been processed. */
  done: boolean;
  /** Activities written in this call. */
  processed: number;
  /** Best estimate of what is left, or null when unknown. */
  remaining: number | null;
  /** Present when Strava's rate limit stopped this batch. */
  rateLimited?: { retryAfterSec: number };
}
