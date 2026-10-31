import { describe, expect, it } from "vitest";
import { deterministicActivityId, hrZoneSecondsForWorkout, parseActivityFile } from "@fittrack/shared";
import type { ActivityTypeRow } from "@/lib/database.types";
import {
  assembleRow, computeIds, chunk, decideStatus, defaultTypeChoice, existingWindow, formatMinutes, importButtonLabel, maxHrFor, needsTzChoice,
  parseTexts, selectionProblem, similarCount, summaryText, validateFiles, validateParsedWorkout,
} from "./logic";

const types: ActivityTypeRow[] = [
  { id: 1, name: "Running", met_light: 7, met_moderate: 9, met_vigorous: 11, has_distance: true, sort_order: 1 },
  { id: 2, name: "Yoga", met_light: 2, met_moderate: 3, met_vigorous: 4, has_distance: false, sort_order: 2 },
  { id: 18, name: "Other", met_light: 3, met_moderate: 4, met_vigorous: 6, has_distance: false, sort_order: 18 },
];

function gpx(timeSuffix = "Z", sport = "running") {
  const pts = Array.from({ length: 12 }, (_, i) => {
    const sec = i * 10; // gaps over 30 s count as pauses, so keep points close
    const t = `2025-01-10T06:0${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}${timeSuffix}`;
    return `<trkpt lat="${12.9 + i * 0.001}" lon="77.6"><ele>900</ele><time>${t}</time><extensions><gpxtpx:hr>${140 + i}</gpxtpx:hr></extensions></trkpt>`;
  }).join("");
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>Morning</name><type>${sport}</type><trkseg>${pts}</trkseg></trk></gpx>`;
}

describe("validateFiles", () => {
  it("rejects wrong extension, empty, big and over-limit", () => {
    const files = [
      { name: "a.gpx", size: 10 }, { name: "b.txt", size: 10 }, { name: "c.tcx", size: 0 }, { name: "d.gpx", size: 11 * 1024 * 1024 },
    ];
    const r = validateFiles(files);
    expect(r.accepted.map((f) => f.name)).toEqual(["a.gpx"]);
    expect(r.rejected).toHaveLength(3);
    const many = Array.from({ length: 22 }, (_, i) => ({ name: `f${i}.GPX`, size: 5 }));
    const r2 = validateFiles(many);
    expect(r2.accepted).toHaveLength(20);
    expect(r2.rejected[0].reason).toMatch(/20 files/);
  });
});

describe("status decision", () => {
  it("covers every kind", () => {
    expect(decideStatus({ problems: ["x"], idExists: true, similarCount: 1 }).kind).toBe("blocked");
    expect(decideStatus({ problems: ["too long"], idExists: false, similarCount: 0 }).label).toBe("Can't import: too long");
    expect(decideStatus({ problems: [], idExists: true, similarCount: 1 })).toMatchObject({ kind: "imported", selectable: false, defaultChecked: false });
    expect(decideStatus({ problems: [], idExists: false, similarCount: 2 })).toMatchObject({ kind: "similar", selectable: true, defaultChecked: false });
    expect(decideStatus({ problems: [], idExists: false, similarCount: 0 })).toMatchObject({ kind: "ready", defaultChecked: true });
  });
});

describe("helpers", () => {
  it("chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 20)).toEqual([]);
    expect(chunk(Array.from({ length: 41 }, (_, i) => i)).map((c) => c.length)).toEqual([20, 20, 1]);
  });
  it("summary and labels", () => {
    expect(summaryText({ imported: 2, skipped: 1, failed: [{ label: "a", reason: "b" }] })).toBe("Imported 2, skipped 1 (already imported or not selected), failed 1.");
    expect(importButtonLabel(1)).toBe("Import 1 workout");
    expect(importButtonLabel(3)).toBe("Import 3 workouts");
    expect(formatMinutes(3900)).toBe("1 h 05 min");
  });
  it("maxHrFor", () => {
    expect(maxHrFor({ max_hr: 190, dob: null })).toBe(190);
    expect(maxHrFor({ max_hr: null, dob: "1990-01-01" }, new Date("2025-06-01"))).toBe(185);
    expect(maxHrFor(null)).toBeNull();
    expect(maxHrFor({ max_hr: null, dob: null })).toBeNull();
  });
  it("similarCount uses type and 30 minute window", () => {
    const ex = [{ id: "z", start_time: "2025-01-10T06:10:00Z", activity_type_id: 1, source: "strava" as const }];
    expect(similarCount("n", 1, "2025-01-10T06:00:00Z", ex)).toBe(1);
    expect(similarCount("n", 2, "2025-01-10T06:00:00Z", ex)).toBe(0);
    expect(similarCount("n", 1, "2025-01-10T08:00:00Z", ex)).toBe(0);
  });
  it("selectionProblem", () => {
    expect(selectionProblem({ typeId: 18, custom: " " }, types)).not.toBeNull();
    expect(selectionProblem({ typeId: 18, custom: "Dance" }, types)).toBeNull();
    expect(selectionProblem({ typeId: 1, custom: "" }, types)).toBeNull();
  });
});

describe("IST switch re-parse", () => {
  it("flags assumed time and shifts by 5:30 without re-reading", () => {
    const files = [{ name: "a.gpx", text: gpx("") }];
    const utc = parseTexts(files, "utc");
    const ist = parseTexts(files, "ist");
    expect(needsTzChoice(utc.items)).toBe(true);
    const diff = Date.parse(utc.items[0].workout.startTime) - Date.parse(ist.items[0].workout.startTime);
    expect(diff).toBe(5.5 * 3600_000);
    expect(needsTzChoice(parseTexts([{ name: "b.gpx", text: gpx("Z") }], "utc").items)).toBe(false);
  });
  it("reports unreadable files", () => {
    const r = parseTexts([{ name: "bad.gpx", text: "hello" }], "utc");
    expect(r.items).toHaveLength(0);
    expect(r.errors[0].fileName).toBe("bad.gpx");
    expect(existingWindow(r.items)).toBeNull();
  });
});

describe("integration: parse -> status -> row", () => {
  it("builds an importable row with the chosen type and zones", async () => {
    const { items } = parseTexts([{ name: "run.gpx", text: gpx("Z") }], "utc");
    expect(items).toHaveLength(1);
    const w = items[0].workout;
    const win = existingWindow(items);
    expect(win && win.fromIso < w.startTime && win.toIso > w.startTime).toBe(true);
    const problems = validateParsedWorkout(w, new Date("2026-01-01"));
    expect(problems).toEqual([]);
    const userId = "11111111-1111-4111-8111-111111111111";
    const id = await deterministicActivityId(userId, w);
    expect(id).toBe(await deterministicActivityId(userId, w));
    const choice = defaultTypeChoice(w, types);
    expect(choice).toEqual({ typeId: 1, custom: "" });
    expect(decideStatus({ problems, idExists: false, similarCount: 0 }).kind).toBe("ready");
    expect(decideStatus({ problems, idExists: true, similarCount: 0 }).kind).toBe("imported");
    const row = assembleRow(w, choice!, { userId, id, fileName: "run.gpx", weightKg: 70, maxHr: 190, types });
    expect(row).toMatchObject({ id, user_id: userId, source: "manual", activity_type_id: 1, custom_name: null, calories_estimated: true });
    expect(row.calories).toBeGreaterThan(0);
    expect(row.notes).toContain("Imported from run.gpx");
    const edited = assembleRow(w, { typeId: 18, custom: "Fun run" }, { userId, id, fileName: "run.gpx", weightKg: null, maxHr: 190, types });
    expect(edited).toMatchObject({ activity_type_id: 18, custom_name: "Fun run", calories: null, calories_estimated: true });
    expect(hrZoneSecondsForWorkout(w, 190)?.length).toBe(5);
  });
  it("blocks a workout in the future", () => {
    const { items } = parseTexts([{ name: "run.gpx", text: gpx("Z") }], "utc");
    expect(validateParsedWorkout(items[0].workout, new Date("2020-01-01")).length).toBeGreaterThan(0);
  });
  it("parseActivityFile rejects empty text", () => expect(parseActivityFile("", {}).ok).toBe(false));
});

describe("computeIds", () => {
  it("one failing workout does not break the others", async () => {
    const { items } = parseTexts([{ name: "a.gpx", text: gpx("Z") }, { name: "b.gpx", text: gpx("Z", "yoga") }], "utc");
    let n = 0;
    const ids = await computeIds(items, async () => { n++; if (n === 1) throw new TypeError("crypto.subtle undefined"); return "id-2"; });
    expect(Object.keys(ids)).toEqual([items[1].key]);
  });
});
