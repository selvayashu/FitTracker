import type { StravaStatus, SyncResult } from "@fittrack/shared";
import { formatIst } from "@/lib/time";

/** Pure Strava UI logic: throttling, countdowns, messages, and the batched sync loop (with injected I/O so it is testable). */

export const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;
export const MAX_RATE_LIMIT_RETRIES = 5;
export const MIN_WAIT_SEC = 5;
export const MAX_WAIT_SEC = 15 * 60;
export const MAX_BATCHES = 200;

/** Auto sync runs when connected and the last attempt (successful or not) was more than 15 minutes ago. */
export function shouldAutoSync(a: { connected: boolean; lastAttemptMs: number | null; nowMs: number }): boolean {
  if (!a.connected) return false;
  if (a.lastAttemptMs === null || !Number.isFinite(a.lastAttemptMs)) return true;
  if (a.lastAttemptMs > a.nowMs) return true; // clock moved back: do not block forever
  return a.nowMs - a.lastAttemptMs > AUTO_SYNC_INTERVAL_MS;
}

export const secondsLeft = (retryAtMs: number, nowMs: number): number => Math.max(0, Math.ceil((retryAtMs - nowMs) / 1000));

/** 65 -> "1:05". */
export function formatCountdown(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const clampWaitSec = (sec: number): number =>
  Math.min(MAX_WAIT_SEC, Math.max(MIN_WAIT_SEC, Number.isFinite(sec) ? Math.ceil(sec) : MIN_WAIT_SEC));

export function progressText(p: { processed: number; remaining: number | null }): string {
  const noun = (n: number) => `${n} ${n === 1 ? "activity" : "activities"}`;
  if (p.remaining === null) return `Synced ${noun(p.processed)} so far`;
  return `Synced ${noun(p.processed)}, about ${p.remaining} left`;
}

export type ErrorAction = "retry" | "reconnect" | "signin";
export interface MappedError { code: string; message: string; action: ErrorAction }

export function mapStravaError(code: string, fallback?: string): MappedError {
  switch (code) {
    case "not_connected":
      return { code, action: "reconnect", message: "Strava is not connected. Connect it to sync your activities." };
    case "strava_revoked":
      return { code, action: "reconnect", message: "Strava access was revoked. Connect Strava again to keep syncing." };
    case "network":
      return { code, action: "retry", message: "Could not reach the server. Check your connection and try again." };
    case "unauthenticated":
      return { code, action: "signin", message: "Your session expired. Please sign in again." };
    default:
      return { code, action: "retry", message: fallback ? `Strava sync failed: ${fallback}` : "Strava sync failed. Please try again." };
  }
}

/** Messages for the `?strava=error&reason=` return URL. */
export function mapReturnReason(reason: string | null): string {
  switch (reason) {
    case "access_denied": return "You declined access on Strava. You can try again whenever you like.";
    case "insufficient_scope":
    case "scope": return "Strava needs permission to view your activities. Connect again and keep the activity access box ticked.";
    case "invalid_state":
    case "state_expired": return "The connection attempt expired. Please try connecting again.";
    case "token_exchange":
    case "exchange_failed": return "Strava did not accept the connection. Please try again.";
    default: return "Could not connect Strava. Please try again.";
  }
}

export type ReturnParams = { kind: "connected" } | { kind: "error"; reason: string | null };

export function parseReturnParams(search: string): ReturnParams | null {
  const p = new URLSearchParams(search);
  const v = p.get("strava");
  if (v === "connected") return { kind: "connected" };
  if (v === "error") return { kind: "error", reason: p.get("reason") };
  return null;
}

/** Query string with the Strava return params removed (keeps any others). */
export function stripReturnParams(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("strava"); p.delete("reason");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function lastSyncText(iso: string | null): string {
  return iso ? `Last sync ${formatIst(iso)} IST` : "Not synced yet";
}

export type SyncPhase = "idle" | "syncing" | "waiting" | "error";
export interface ChipInput {
  connected: boolean;
  phase: SyncPhase;
  lastSyncAt: string | null;
  countdownSec: number;
  error: MappedError | null;
}
export interface ChipView { label: string; tone: "ok" | "busy" | "warn" | "error"; showRetry: boolean }

export function chipView(c: ChipInput): ChipView | null {
  if (!c.connected) return null;
  if (c.phase === "syncing") return { label: "Syncing Strava...", tone: "busy", showRetry: false };
  if (c.phase === "waiting") return { label: `Rate limited, retrying in ${formatCountdown(c.countdownSec)}`, tone: "warn", showRetry: false };
  if (c.phase === "error") {
    const retryable = !c.error || c.error.action === "retry";
    return { label: retryable ? "Strava sync failed" : c.error!.message, tone: "error", showRetry: retryable };
  }
  return { label: lastSyncText(c.lastSyncAt), tone: "ok", showRetry: false };
}

export const needsReconnect = (e: MappedError | null) => e?.action === "reconnect";
export const isConnected = (s: StravaStatus | null) => !!s?.connected;

export interface SyncLoopDeps {
  run: (mode?: "initial" | "incremental") => Promise<SyncResult>;
  /** Wait `sec` seconds. Must resolve early if cancelled. */
  wait: (sec: number) => Promise<void>;
  isCancelled: () => boolean;
  onProgress: (p: { processed: number; remaining: number | null }) => void;
  onRateLimited: (sec: number) => void;
  onResume: () => void;
  mode?: "initial" | "incremental";
}
export type SyncOutcome = "done" | "cancelled" | "gave_up";

/** Call the sync endpoint until `done`; wait out rate limits (bounded); errors propagate to the caller. */
export async function syncLoop(d: SyncLoopDeps): Promise<{ outcome: SyncOutcome; processed: number }> {
  let processed = 0;
  let retries = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    if (d.isCancelled()) return { outcome: "cancelled", processed };
    const r = await d.run(d.mode);
    if (d.isCancelled()) return { outcome: "cancelled", processed };
    processed += r.processed;
    d.onProgress({ processed, remaining: r.remaining });
    if (r.rateLimited) {
      if (retries >= MAX_RATE_LIMIT_RETRIES) return { outcome: "gave_up", processed };
      retries++;
      const sec = clampWaitSec(r.rateLimited.retryAfterSec);
      d.onRateLimited(sec);
      await d.wait(sec);
      if (d.isCancelled()) return { outcome: "cancelled", processed };
      d.onResume();
      continue;
    }
    if (r.done) return { outcome: "done", processed };
  }
  return { outcome: "gave_up", processed };
}
