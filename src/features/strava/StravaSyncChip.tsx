import { chipView } from "./logic";
import type { UseStrava } from "./useStrava";

const TONE = {
  ok: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  busy: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
} as const;

/** Small status chip for Home and Activity. Renders nothing unless Strava is connected. */
export function StravaSyncChip({ strava }: { strava: UseStrava }) {
  const view = chipView({
    connected: strava.connected, phase: strava.phase, lastSyncAt: strava.status?.last_sync_at ?? null,
    countdownSec: strava.countdownSec, error: strava.error,
  });
  if (!view) return null;
  return (
    <div role="status" aria-label="Strava sync status" className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${TONE[view.tone]}`}>
      <span aria-hidden="true" className="font-semibold">Strava</span>
      <span>{view.label}</span>
      {view.showRetry && (
        <button type="button" onClick={() => void strava.syncNow()} className="rounded-full border border-current px-2 py-0.5 font-medium">Retry</button>
      )}
    </div>
  );
}
