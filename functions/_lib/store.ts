/** Persistence. `Store` is the interface the engine and handlers use; `createSupabaseStore` is the service-role implementation. */
import { createClient } from "@supabase/supabase-js";
import type { ActivitySource, StravaActivityUpsert } from "@fittrack/shared";

export interface SyncCursor {
  mode: "initial" | "incremental";
  /** Unix seconds: list activities after this instant. */
  after?: number;
  page?: number;
  /** Strava activity ids still to process. */
  pending?: number[];
  /** Epoch ms until which a running sync owns the cursor. */
  lease_until?: number;
}

export interface Connection {
  user_id: string;
  athlete_id: number;
  access_token: string;
  refresh_token: string;
  /** Unix seconds. */
  expires_at: number;
  scope: string | null;
  last_sync_at: string | null;
  sync_cursor: SyncCursor | null;
  /** Used for the optimistic lease update. */
  updated_at: string;
}

export interface ActivityTypeRow {
  id: number;
  name: string;
  met_light: number;
  met_moderate: number;
  met_vigorous: number;
}

export interface ProfileRow {
  weight_kg: number | null;
  max_hr: number | null;
  dob: string | null;
}

export interface ExistingActivity {
  id: string;
  strava_id: number;
  duplicate_of: string | null;
  duplicate_dismissed: boolean;
}

export interface NearActivity {
  id: string;
  activity_type_id: number;
  start_time: string;
  source: ActivitySource;
}

export interface HrZonesRow {
  activity_id: string;
  user_id: string;
  zone1_s: number;
  zone2_s: number;
  zone3_s: number;
  zone4_s: number;
  zone5_s: number;
  max_hr_used: number;
}

export interface Store {
  getConnection(userId: string): Promise<Connection | null>;
  getConnectionByAthlete(athleteId: number): Promise<Connection | null>;
  upsertConnection(row: {
    user_id: string;
    athlete_id: number;
    access_token: string;
    refresh_token: string;
    expires_at: number;
    scope: string | null;
    sync_cursor: SyncCursor;
  }): Promise<void>;
  updateTokens(userId: string, t: { access_token: string; refresh_token: string; expires_at: number }): Promise<void>;
  /** Takes the sync lease atomically. Returns the cursor (with lease_until set) or null when leased or contended. */
  acquireLease(
    conn: Connection,
    nowMs: number,
    leaseMs: number,
    prepare: (current: SyncCursor | null) => SyncCursor,
  ): Promise<SyncCursor | null>;
  saveCursor(userId: string, cursor: SyncCursor, opts?: { lastSyncAt?: string }): Promise<void>;
  listActivityTypes(): Promise<ActivityTypeRow[]>;
  getProfile(userId: string): Promise<ProfileRow | null>;
  findStravaActivities(userId: string, stravaIds: number[]): Promise<ExistingActivity[]>;
  /** Upserts by strava_id; returns the id of the stored row. */
  upsertStravaActivity(row: StravaActivityUpsert): Promise<string>;
  findManualActivitiesNear(userId: string, startIso: string, windowMin: number): Promise<NearActivity[]>;
  /** Only sets the link while duplicate_of is null and duplicate_dismissed is false. */
  setDuplicateOf(userId: string, activityId: string, manualId: string): Promise<void>;
  upsertHrZones(row: HrZonesRow): Promise<void>;
  deleteByStravaId(userId: string, stravaId: number): Promise<void>;
  deleteConnection(userId: string): Promise<void>;
  deleteStravaActivities(userId: string): Promise<void>;
}

function toCursor(v: unknown): SyncCursor | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const c: SyncCursor = { mode: o.mode === "incremental" ? "incremental" : "initial" };
  if (typeof o.after === "number") c.after = o.after;
  if (typeof o.page === "number") c.page = o.page;
  if (Array.isArray(o.pending)) c.pending = o.pending.filter((x): x is number => typeof x === "number");
  if (typeof o.lease_until === "number") c.lease_until = o.lease_until;
  return c;
}

const CONN_COLS =
  "user_id, athlete_id, access_token, refresh_token, expires_at, scope, last_sync_at, sync_cursor, updated_at";

function toConnection(r: Record<string, unknown>): Connection {
  return {
    user_id: String(r.user_id),
    athlete_id: Number(r.athlete_id),
    access_token: String(r.access_token),
    refresh_token: String(r.refresh_token),
    expires_at: Math.floor(Date.parse(String(r.expires_at)) / 1000),
    scope: (r.scope as string | null) ?? null,
    last_sync_at: (r.last_sync_at as string | null) ?? null,
    sync_cursor: toCursor(r.sync_cursor),
    updated_at: String(r.updated_at),
  };
}

const iso = (sec: number) => new Date(sec * 1000).toISOString();

export function createSupabaseStore(opts: { url: string; serviceRoleKey: string; fetch?: typeof fetch }): Store {
  const db = createClient(opts.url, opts.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: opts.fetch ? { fetch: opts.fetch } : undefined,
  });

  const fail = (what: string, err: { message?: string; code?: string } | null): never => {
    // Only a short label and the PostgREST code: never row data.
    throw new Error(`store ${what} failed${err?.code ? ` (${err.code})` : ""}`);
  };

  return {
    async getConnection(userId) {
      const { data, error } = await db.from("strava_connections").select(CONN_COLS).eq("user_id", userId).maybeSingle();
      if (error) fail("getConnection", error);
      return data ? toConnection(data as Record<string, unknown>) : null;
    },
    async getConnectionByAthlete(athleteId) {
      const { data, error } = await db
        .from("strava_connections")
        .select(CONN_COLS)
        .eq("athlete_id", athleteId)
        .maybeSingle();
      if (error) fail("getConnectionByAthlete", error);
      return data ? toConnection(data as Record<string, unknown>) : null;
    },
    async upsertConnection(row) {
      const { error } = await db.from("strava_connections").upsert(
        {
          user_id: row.user_id,
          athlete_id: row.athlete_id,
          access_token: row.access_token,
          refresh_token: row.refresh_token,
          expires_at: iso(row.expires_at),
          scope: row.scope,
          sync_cursor: row.sync_cursor,
        },
        { onConflict: "user_id" },
      );
      if (error) fail("upsertConnection", error);
    },
    async updateTokens(userId, t) {
      const { error } = await db
        .from("strava_connections")
        .update({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: iso(t.expires_at) })
        .eq("user_id", userId);
      if (error) fail("updateTokens", error);
    },
    async acquireLease(conn, nowMs, leaseMs, prepare) {
      const cur = conn.sync_cursor;
      if (cur?.lease_until && cur.lease_until > nowMs) return null;
      const next: SyncCursor = { ...prepare(cur), lease_until: nowMs + leaseMs };
      const { data, error } = await db
        .from("strava_connections")
        .update({ sync_cursor: next })
        .eq("user_id", conn.user_id)
        .eq("updated_at", conn.updated_at)
        .select("user_id");
      if (error) fail("acquireLease", error);
      return data && data.length > 0 ? next : null;
    },
    async saveCursor(userId, cursor, o) {
      const patch: Record<string, unknown> = { sync_cursor: cursor };
      if (o?.lastSyncAt) patch.last_sync_at = o.lastSyncAt;
      const { error } = await db.from("strava_connections").update(patch).eq("user_id", userId);
      if (error) fail("saveCursor", error);
    },
    async listActivityTypes() {
      const { data, error } = await db.from("activity_types").select("id, name, met_light, met_moderate, met_vigorous");
      if (error) fail("listActivityTypes", error);
      return (data ?? []).map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        met_light: Number(r.met_light),
        met_moderate: Number(r.met_moderate),
        met_vigorous: Number(r.met_vigorous),
      }));
    },
    async getProfile(userId) {
      const { data, error } = await db
        .from("profiles")
        .select("weight_kg, max_hr, dob")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) fail("getProfile", error);
      if (!data) return null;
      return {
        weight_kg: data.weight_kg == null ? null : Number(data.weight_kg),
        max_hr: data.max_hr == null ? null : Number(data.max_hr),
        dob: (data.dob as string | null) ?? null,
      };
    },
    async findStravaActivities(userId, stravaIds) {
      if (stravaIds.length === 0) return [];
      const { data, error } = await db
        .from("activities")
        .select("id, strava_id, duplicate_of, duplicate_dismissed")
        .eq("user_id", userId)
        .in("strava_id", stravaIds);
      if (error) fail("findStravaActivities", error);
      return (data ?? []).map((r) => ({
        id: String(r.id),
        strava_id: Number(r.strava_id),
        duplicate_of: (r.duplicate_of as string | null) ?? null,
        duplicate_dismissed: !!r.duplicate_dismissed,
      }));
    },
    async upsertStravaActivity(row) {
      // 1) Insert, ignoring a conflict, so an existing row's id is never rewritten.
      const ins = await db
        .from("activities")
        .upsert(row, { onConflict: "strava_id", ignoreDuplicates: true })
        .select("id");
      if (ins.error) fail("upsertStravaActivity", ins.error);
      if (ins.data && ins.data.length > 0) return String((ins.data[0] as { id: string }).id);
      // 2) Row already existed: update only the Strava-owned columns (the payload never has notes/excluded/...).
      const patch: Record<string, unknown> = { ...row };
      delete patch.id;
      delete patch.user_id;
      const upd = await db
        .from("activities")
        .update(patch)
        .eq("strava_id", row.strava_id)
        .eq("user_id", row.user_id)
        .select("id");
      if (upd.error) fail("upsertStravaActivity", upd.error);
      if (!upd.data || upd.data.length === 0) return fail("upsertStravaActivity", null);
      return String((upd.data[0] as { id: string }).id);
    },
    async findManualActivitiesNear(userId, startIso, windowMin) {
      const t = Date.parse(startIso);
      const lo = new Date(t - windowMin * 60_000).toISOString();
      const hi = new Date(t + windowMin * 60_000).toISOString();
      const { data, error } = await db
        .from("activities")
        .select("id, activity_type_id, start_time, source")
        .eq("user_id", userId)
        .eq("source", "manual")
        .eq("excluded", false)
        .gte("start_time", lo)
        .lte("start_time", hi);
      if (error) fail("findManualActivitiesNear", error);
      return (data ?? []).map((r) => ({
        id: String(r.id),
        activity_type_id: Number(r.activity_type_id),
        start_time: String(r.start_time),
        source: "manual" as const,
      }));
    },
    async setDuplicateOf(userId, activityId, manualId) {
      const { error } = await db
        .from("activities")
        .update({ duplicate_of: manualId })
        .eq("id", activityId)
        .eq("user_id", userId)
        .eq("duplicate_dismissed", false)
        .is("duplicate_of", null);
      if (error) fail("setDuplicateOf", error);
    },
    async upsertHrZones(row) {
      const { error } = await db.from("activity_hr_zones").upsert(row, { onConflict: "activity_id" });
      if (error) fail("upsertHrZones", error);
    },
    async deleteByStravaId(userId, stravaId) {
      const { error } = await db.from("activities").delete().eq("user_id", userId).eq("strava_id", stravaId);
      if (error) fail("deleteByStravaId", error);
    },
    async deleteConnection(userId) {
      const { error } = await db.from("strava_connections").delete().eq("user_id", userId);
      if (error) fail("deleteConnection", error);
    },
    async deleteStravaActivities(userId) {
      const { error } = await db.from("activities").delete().eq("user_id", userId).eq("source", "strava");
      if (error) fail("deleteStravaActivities", error);
    },
  };
}
