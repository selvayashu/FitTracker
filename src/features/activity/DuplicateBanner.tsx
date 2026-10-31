import type { ActivityRow, ActivityTypeRow } from "@/lib/database.types";
import { formatDuration, formatIst } from "@/lib/time";
import type { DuplicateAction } from "./duplicates";
import { stravaTitle } from "./logic";

interface Props {
  other: ActivityRow | null;
  types: ActivityTypeRow[];
  online: boolean;
  busy: boolean;
  error: string | null;
  onAction: (a: DuplicateAction) => void;
}

/** Review prompt for a Strava activity that overlaps another activity. */
export function DuplicateBanner({ other, types, online, busy, error, onAction }: Props) {
  const btn = "rounded-md border border-amber-700 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-amber-300";
  const disabled = busy || !online;
  return (
    <div role="group" aria-label="Possible duplicate" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      <p>
        Possible duplicate of{" "}
        {other
          ? <b>{stravaTitle(other, types)} ({other.source === "manual" ? "manual" : "Strava"}, {formatIst(other.start_time)} IST, {formatDuration(Math.round(Number(other.duration_min)))})</b>
          : "another activity"}.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={disabled} onClick={() => onAction("keep_strava")}>Keep Strava</button>
        <button type="button" className={btn} disabled={disabled} onClick={() => onAction("keep_manual")}>Keep manual</button>
        <button type="button" className={btn} disabled={disabled} onClick={() => onAction("not_duplicate")}>Not a duplicate</button>
      </div>
      <p className="mt-1">Keep Strava deletes the manual entry. Keep manual hides the Strava one.</p>
      {!online && <p className="mt-1" role="status">You are offline. Reconnect to resolve duplicates.</p>}
      {error && <p className="mt-1 text-red-700 dark:text-red-300" role="alert">{error}</p>}
    </div>
  );
}
