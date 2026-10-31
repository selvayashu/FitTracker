import type { ActivityHrZoneRow } from "@/lib/database.types";
import { ZONE_COLORS, hasZoneData, zoneSegments, zoneSummary } from "./zones";

/** Stacked bar of time in heart-rate zones 1-5 with a labelled legend (minutes and bpm range). */
export function ZoneBar({ zones }: { zones: ActivityHrZoneRow }) {
  if (!hasZoneData(zones)) return null;
  const segs = zoneSegments(zones);
  return (
    <div className="mt-2">
      <div role="img" aria-label={zoneSummary(zones)} className="flex h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        {segs.map((s) => s.pct > 0 && (
          <i key={s.zone} style={{ width: `${s.pct}%`, background: ZONE_COLORS[s.zone - 1] }} />
        ))}
      </div>
      <ul className="mt-1 grid grid-cols-5 gap-1 text-center text-[11px] text-slate-600 dark:text-slate-300">
        {segs.map((s) => (
          <li key={s.zone}>
            <span aria-hidden="true" className="mx-auto mb-0.5 block h-1.5 w-4 rounded-full" style={{ background: ZONE_COLORS[s.zone - 1] }} />
            <span className="block font-medium">Z{s.zone}</span>
            <span className="block">{s.minutes} min</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Zones based on max HR {zones.max_hr_used} bpm.</p>
    </div>
  );
}
