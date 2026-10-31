import type { StravaStatus } from "@fittrack/shared";
import { StravaApiError, disconnectStrava, getStravaStatus, runSync } from "@/lib/strava";
import { removeStravaLocal } from "@/features/activity/store";
import { mapStravaError, shouldAutoSync, syncLoop, type MappedError, type SyncPhase } from "./logic";

/**
 * Module-level Strava state shared by the card, the chips and the auto sync, so two components never start two syncs.
 * Nothing here talks to /api/strava until a caller explicitly asks (callers only do so in Strava mode).
 */
export interface StravaSnapshot {
  status: StravaStatus | null;
  statusLoading: boolean;
  statusError: string | null;
  phase: SyncPhase;
  processed: number;
  remaining: number | null;
  retryAtMs: number | null;
  error: MappedError | null;
  /** Bumped whenever a sync run finishes (so lists can reload). */
  syncRevision: number;
  disconnecting: boolean;
}

const initial: StravaSnapshot = {
  status: null, statusLoading: false, statusError: null, phase: "idle", processed: 0, remaining: null,
  retryAtMs: null, error: null, syncRevision: 0, disconnecting: false,
};

let snap: StravaSnapshot = initial;
let userId: string | null = null;
let runId = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let wake: (() => void) | null = null;
let autoDone = false;
const listeners = new Set<() => void>();

const set = (patch: Partial<StravaSnapshot>) => { snap = { ...snap, ...patch }; listeners.forEach((l) => l()); };
export const getSnapshot = () => snap;
export function subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }

const attemptKey = (uid: string) => `ft.strava.lastAttempt.${uid}`;
function readAttempt(uid: string): number | null {
  try { const v = localStorage.getItem(attemptKey(uid)); return v ? Number(v) : null; } catch { return null; }
}
function writeAttempt(uid: string, ms: number) {
  try { localStorage.setItem(attemptKey(uid), String(ms)); } catch { /* storage unavailable */ }
}

function cancelRun() {
  runId++;
  if (timer) { clearTimeout(timer); timer = null; }
  if (wake) { const w = wake; wake = null; w(); }
}

/** Bind the store to the signed-in user; a different user starts from a clean slate. */
export function bindUser(uid: string | null) {
  if (uid === userId) return;
  cancelRun();
  userId = uid;
  autoDone = false;
  snap = initial;
  listeners.forEach((l) => l());
}

/** Stop waiting/looping (used when the last consumer unmounts). */
export function cancelSync() {
  cancelRun();
  if (snap.phase === "syncing" || snap.phase === "waiting") set({ phase: "idle", retryAtMs: null });
}

export async function refreshStatus(): Promise<StravaStatus | null> {
  const uid = userId;
  if (!uid) return null;
  set({ statusLoading: true, statusError: null });
  try {
    const status = await getStravaStatus();
    if (uid !== userId) return null;
    set({ status, statusLoading: false });
    return status;
  } catch (e) {
    if (uid === userId) set({ statusLoading: false, statusError: e instanceof Error ? e.message : "Could not load Strava status." });
    return null;
  }
}

/** Resolves true when the server actually answered (success or a Worker/Strava error); false for network failures and cancellation. */
export async function syncNow(mode?: "initial" | "incremental"): Promise<boolean> {
  const uid = userId;
  if (!uid || snap.phase === "syncing" || snap.phase === "waiting") return false;
  const my = ++runId;
  const cancelled = () => my !== runId;
  let responded = false;
  const markResponded = () => { if (!responded) { responded = true; writeAttempt(uid, Date.now()); } };
  set({ phase: "syncing", processed: 0, remaining: null, retryAtMs: null, error: null });
  try {
    const res = await syncLoop({
      run: runSync,
      mode,
      isCancelled: cancelled,
      onResponse: markResponded,
      wait: (sec) => new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(() => { timer = null; wake = null; resolve(); }, sec * 1000);
      }),
      onProgress: (p) => { if (!cancelled()) set({ processed: p.processed, remaining: p.remaining }); },
      onRateLimited: (sec) => { if (!cancelled()) set({ phase: "waiting", retryAtMs: Date.now() + sec * 1000 }); },
      onResume: () => { if (!cancelled()) set({ phase: "syncing", retryAtMs: null }); },
    });
    if (res.outcome === "cancelled") return responded;
    if (res.outcome === "rate_limited") {
      set({ phase: "error", retryAtMs: null, error: { code: "rate_limited", action: "retry", message: "Strava is still limiting requests. Try again in a few minutes." } });
    } else if (res.outcome === "busy") {
      set({ phase: "error", retryAtMs: null, error: { code: "busy", action: "retry", message: "A sync is already running, try again in a minute." } });
    } else if (res.outcome === "too_many_batches") {
      set({ phase: "error", retryAtMs: null, error: { code: "too_many_batches", action: "retry", message: "Still importing... tap Sync now to continue." } });
    } else {
      set({ phase: "idle", retryAtMs: null });
    }
  } catch (e) {
    if (cancelled()) return responded;
    // Any HTTP answer (status > 0) counts as a response; network failures and local auth problems do not.
    if (e instanceof StravaApiError && e.status > 0 && e.code !== "unauthenticated") markResponded();
    const err = e instanceof StravaApiError ? mapStravaError(e.code, e.message) : mapStravaError("error", e instanceof Error ? e.message : undefined);
    set({ phase: "error", retryAtMs: null, error: err });
  }
  if (cancelled()) return responded;
  set({ syncRevision: snap.syncRevision + 1 });
  await refreshStatus();
  return responded;
}

/** One incremental sync per app open, at most once per 15 minutes. Never throws, never blocks. */
export function maybeAutoSync(): void {
  const uid = userId;
  if (!uid || autoDone || !snap.status?.connected) return;
  if (!shouldAutoSync({ connected: true, lastAttemptMs: readAttempt(uid), nowMs: Date.now() })) { autoDone = true; return; }
  // Only a real server answer marks the check as done; a network failure or an unmount lets the next open try again.
  void syncNow(snap.status.last_sync_at ? "incremental" : "initial").then((responded) => { if (responded && uid === userId) autoDone = true; });
}

export async function disconnect(deleteActivities: boolean): Promise<string | null> {
  if (!userId) return "Please sign in again.";
  cancelRun();
  set({ disconnecting: true, phase: "idle", retryAtMs: null, error: null });
  try {
    await disconnectStrava(deleteActivities);
    if (deleteActivities) removeStravaLocal();
    set({ disconnecting: false, syncRevision: snap.syncRevision + 1 });
    await refreshStatus();
    return null;
  } catch (e) {
    set({ disconnecting: false });
    return e instanceof StravaApiError ? mapStravaError(e.code, e.message).message : "Could not disconnect Strava.";
  }
}
