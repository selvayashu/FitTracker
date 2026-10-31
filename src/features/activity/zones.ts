import { hrZones } from "@fittrack/shared";
import type { ActivityHrZoneRow } from "@/lib/database.types";

export interface ZoneSegment { zone: 1 | 2 | 3 | 4 | 5; seconds: number; minutes: number; pct: number; minBpm: number; maxBpm: number }

/** Okabe-Ito colour-blind-safe palette, one per zone. */
export const ZONE_COLORS = ["#56B4E9", "#009E73", "#F0E442", "#E69F00", "#D55E00"] as const;

export function zoneSegments(z: ActivityHrZoneRow): ZoneSegment[] {
  const secs = [z.zone1_s, z.zone2_s, z.zone3_s, z.zone4_s, z.zone5_s].map((n) => Math.max(0, Number(n) || 0));
  const total = secs.reduce((a, b) => a + b, 0);
  return hrZones(z.max_hr_used).map((b, i) => ({
    zone: b.zone, seconds: secs[i], minutes: Math.round(secs[i] / 60), pct: total > 0 ? (secs[i] / total) * 100 : 0,
    minBpm: b.minBpm, maxBpm: b.maxBpm,
  }));
}

export const hasZoneData = (z: ActivityHrZoneRow): boolean =>
  [z.zone1_s, z.zone2_s, z.zone3_s, z.zone4_s, z.zone5_s].some((n) => Number(n) > 0);

export function zoneSummary(z: ActivityHrZoneRow): string {
  return `Time in heart rate zones (max HR ${z.max_hr_used}): ` +
    zoneSegments(z).map((s) => `Zone ${s.zone} ${s.minutes} min`).join(", ");
}
