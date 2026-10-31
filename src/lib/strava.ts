import type { StravaStatus, SyncResult } from "@fittrack/shared";
import { supabase } from "./supabase";

/**
 * Browser client for the Strava Worker API (functions/api/strava/*). Part of the Phase 2 contract (frozen).
 * The browser never sees Strava tokens: status comes from the strava_status() RPC, everything else goes through the Worker.
 */
export class StravaApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new StravaApiError("unauthenticated", "Please sign in again.", 401);
  let res: Response;
  try {
    res = await fetch(`/api/strava/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new StravaApiError("network", "Could not reach the server. Check your connection.", 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string } & Record<string, unknown>;
  if (!res.ok) throw new StravaApiError(json.error ?? "error", json.message ?? `Request failed (${res.status})`, res.status);
  return json as T;
}

export async function getStravaStatus(): Promise<StravaStatus> {
  const { data, error } = await supabase.rpc("strava_status");
  if (error) throw new StravaApiError("status", error.message, 500);
  const row = (Array.isArray(data) ? data[0] : data) as StravaStatus | null | undefined;
  return row ?? { connected: false, athlete_id: null, last_sync_at: null, scope: null };
}

/** Ask the Worker for the Strava authorize URL, then send the browser there. */
export async function startStravaConnect(): Promise<void> {
  const { url } = await call<{ url: string }>("connect");
  window.location.assign(url);
}

/** One batch. Call repeatedly until `done`; when `rateLimited` is set, wait `retryAfterSec` first. */
export const runSync = (mode?: "initial" | "incremental") => call<SyncResult>("sync", mode ? { mode } : {});

export const disconnectStrava = (deleteActivities = false) =>
  call<{ deauthorized: boolean }>("disconnect", { deleteActivities });
