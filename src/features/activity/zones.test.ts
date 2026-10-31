import { describe, expect, it } from "vitest";
import type { ActivityHrZoneRow } from "@/lib/database.types";
import { hasZoneData, zoneSegments, zoneSummary } from "./zones";

const z = (o: Partial<ActivityHrZoneRow> = {}): ActivityHrZoneRow => ({
  activity_id: "a", user_id: "u", zone1_s: 600, zone2_s: 1200, zone3_s: 600, zone4_s: 0, zone5_s: 0, max_hr_used: 190, created_at: "", ...o,
});

describe("zones", () => {
  it("computes minutes, percentages and bpm ranges", () => {
    const s = zoneSegments(z());
    expect(s.map((x) => x.minutes)).toEqual([10, 20, 10, 0, 0]);
    expect(s.reduce((a, b) => a + b.pct, 0)).toBeCloseTo(100);
    expect(s[1].pct).toBeCloseTo(50);
    expect(s[0].minBpm).toBe(95);
    expect(s[4].maxBpm).toBe(190);
  });
  it("handles all-zero and negative data", () => {
    const s = zoneSegments(z({ zone1_s: 0, zone2_s: -5, zone3_s: 0 }));
    expect(s.every((x) => x.pct === 0 && x.seconds === 0)).toBe(true);
    expect(hasZoneData(z({ zone1_s: 0, zone2_s: 0, zone3_s: 0 }))).toBe(false);
    expect(hasZoneData(z())).toBe(true);
  });
  it("summarises for screen readers", () =>
    expect(zoneSummary(z())).toBe("Time in heart rate zones (max HR 190): Zone 1 10 min, Zone 2 20 min, Zone 3 10 min, Zone 4 0 min, Zone 5 0 min"));
});
