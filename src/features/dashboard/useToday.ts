import { useCallback, useEffect, useRef, useState } from "react";
import { todaySnapshot, type TodaySnapshot } from "@fittrack/shared";
import { loadReportInputs, toReportProfile } from "@/lib/rangeData";
import { istToday } from "@/lib/time";
import type { ProfileRow } from "@/lib/database.types";
import { isStale } from "./present";

/** `profileKey` ties a cached snapshot to the exact targets it was computed with. */
export interface TodayData { snapshot: TodaySnapshot; latestWeightKg: number | null; fetchedAt: number; profileKey?: string }

const KEY = "ft.dashboard.today.v1.";
const memory = new Map<string, TodayData>();

function readCache(userId: string, profileKey: string): TodayData | null {
  const m = memory.get(userId);
  if (m) return m.profileKey === profileKey ? m : null;
  try {
    const raw = localStorage.getItem(KEY + userId);
    if (!raw) return null;
    const v = JSON.parse(raw) as TodayData;
    if (v && v.snapshot && typeof v.snapshot.date === "string" && v.profileKey === profileKey) { memory.set(userId, v); return v; }
  } catch { /* storage unavailable or corrupt */ }
  return null;
}

function writeCache(userId: string, v: TodayData) {
  memory.set(userId, v);
  try { localStorage.setItem(KEY + userId, JSON.stringify(v)); } catch { /* storage full or unavailable */ }
}

export interface UseToday {
  data: TodayData | null;
  loading: boolean;
  error: string | null;
  /** Showing a snapshot that is not from a successful fetch just now (fetch failed, or device offline). */
  stale: boolean;
  incomplete: boolean;
  reload: () => void;
}

/** Today's snapshot for the signed-in user. Refetches on visibility, focus and IST date change. */
export function useToday(userId: string | null, profile: ProfileRow | null, profileReady: boolean): UseToday {
  const reportProfile = toReportProfile(profile);
  const incomplete = profileReady && !reportProfile;
  const profileKey = JSON.stringify(reportProfile);
  const [data, setData] = useState<TodayData | null>(() => (userId ? readCache(userId, profileKey) : null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const seq = useRef(0);
  const dataRef = useRef<TodayData | null>(data);
  dataRef.current = data;

  const load = useCallback(async () => {
    if (!userId || !reportProfile) { setLoading(false); return; }
    const mine = ++seq.current;
    const today = istToday();
    try {
      const inputs = await loadReportInputs(userId, { from: today, to: today }, today, reportProfile);
      if (mine !== seq.current) return;
      const snapshot = todaySnapshot(inputs);
      const last = inputs.weights.length ? inputs.weights[inputs.weights.length - 1] : undefined;
      const v: TodayData = { snapshot, latestWeightKg: last ? last.weight_kg : null, fetchedAt: Date.now(), profileKey };
      writeCache(userId, v);
      setData(v); setError(null); setStale(false);
    } catch (e) {
      if (mine !== seq.current) return;
      const msg = e instanceof Error ? e.message : "Could not load today";
      // Never show another day's numbers as today's: an old-date cache is shown only with the stale note.
      if (dataRef.current) setStale(true);
      setError(dataRef.current ? null : msg);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profileKey]);

  // Switch user or change targets: use only a cache computed with the same profile, never old targets.
  useEffect(() => { setData(userId ? readCache(userId, profileKey) : null); }, [userId, profileKey]);

  useEffect(() => { if (profileReady) void load(); }, [load, profileReady]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    const onFocus = () => { void load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => {
      if (isStale(dataRef.current?.snapshot.date, istToday())) void load();
    }, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [load]);

  return { data, loading, error, stale, incomplete, reload: () => { setLoading(true); void load(); } };
}
