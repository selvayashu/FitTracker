import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useSession } from "@/lib/session";
import { secondsLeft } from "./logic";
import {
  bindUser, cancelSync, disconnect as storeDisconnect, getSnapshot, maybeAutoSync, refreshStatus, subscribe, syncNow as storeSyncNow,
  type StravaSnapshot,
} from "./stravaStore";

let consumers = 0;

export interface UseStrava extends StravaSnapshot {
  connected: boolean;
  /** Seconds until the rate-limit retry (0 when not waiting). Re-renders every second while waiting. */
  countdownSec: number;
  refresh: () => Promise<void>;
  /** Resolves true once the server has answered. */
  syncNow: (mode?: "initial" | "incremental") => Promise<boolean>;
  disconnect: (deleteActivities: boolean) => Promise<string | null>;
}

/**
 * Strava status + sync for the signed-in user.
 * `enabled` must be true only in Strava tracking mode; when false nothing is fetched and /api/strava is never called.
 * `autoSync` runs one incremental sync per app open (at most once per 15 minutes) once the status says connected.
 */
export function useStrava({ enabled, autoSync = false }: { enabled: boolean; autoSync?: boolean }): UseStrava {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { bindUser(userId); }, [userId]);

  // Cancel pending retries when the last consumer unmounts (deferred so React StrictMode's remount does not cancel a fresh run).
  useEffect(() => {
    consumers++;
    return () => {
      consumers--;
      setTimeout(() => { if (consumers === 0) cancelSync(); }, 0);
    };
  }, []);

  const loaded = snap.status !== null;
  useEffect(() => {
    if (enabled && userId && !loaded) void refreshStatus();
  }, [enabled, userId, loaded]);

  const connected = enabled && !!snap.status?.connected;
  useEffect(() => {
    if (autoSync && connected) maybeAutoSync();
  }, [autoSync, connected]);

  useEffect(() => {
    if (snap.phase !== "waiting") return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [snap.phase]);

  const refresh = useCallback(async () => { await refreshStatus(); }, []);
  const syncNow = useCallback(async (mode?: "initial" | "incremental") => {
    if (!enabled) return false;
    return storeSyncNow(mode ?? (getSnapshot().status?.last_sync_at ? "incremental" : "initial"));
  }, [enabled]);

  return {
    ...snap,
    connected,
    countdownSec: snap.phase === "waiting" && snap.retryAtMs !== null ? secondsLeft(snap.retryAtMs, now) : 0,
    refresh,
    syncNow,
    disconnect: storeDisconnect,
  };
}
