import { describe, expect, it } from "vitest";
import {
  buildImportRow,
  detectFormat,
  deterministicActivityId,
  hrZoneSecondsForWorkout,
  mapFileSport,
  parseActivityFile,
  validateParsedWorkout,
} from "./activityFiles";
import type { ParsedWorkout } from "./importTypes";

function ok(
  text: string,
  opts?: Parameters<typeof parseActivityFile>[1],
): ParsedWorkout[] {
  const r = parseActivityFile(text, opts);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.workouts;
}

function isoAt(base: string, sec: number): string {
  return new Date(Date.parse(base) + sec * 1000).toISOString();
}

interface P {
  lat?: number;
  lon?: number;
  sec: number;
  ele?: number;
  hr?: number | string;
  hrTag?: string;
}

function gpxPts(pts: P[], base = "2026-03-10T01:00:00Z"): string {
  return pts
    .map((p) => {
      const lat = p.lat ?? 12.9;
      const lon = p.lon ?? 77.6;
      const ele = p.ele !== undefined ? `<ele>${p.ele}</ele>` : "";
      const hr =
        p.hr !== undefined
          ? `<extensions><gpxtpx:TrackPointExtension><${p.hrTag ?? "gpxtpx:hr"}>${p.hr}</${p.hrTag ?? "gpxtpx:hr"}></gpxtpx:TrackPointExtension></extensions>`
          : "";
      return `<trkpt lat="${lat}" lon="${lon}">${ele}<time>${isoAt(base, p.sec)}</time>${hr}</trkpt>`;
    })
    .join("\n");
}

function gpx(trks: string, extra = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1"
 xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">${extra}${trks}</gpx>`;
}

const garminPts: P[] = [
  { sec: 0, lat: 12.9, ele: 100, hr: 120 },
  { sec: 10, lat: 12.901, ele: 100.4, hr: 130 },
  { sec: 20, lat: 12.902, ele: 101, hr: 140 },
  { sec: 30, lat: 12.903, ele: 103, hr: 150 },
  { sec: 70, lat: 12.904, ele: 103.5, hr: 150 }, // 40 s pause
  { sec: 80, lat: 12.905, ele: 102, hr: 160 },
  { sec: 90, lat: 12.906, ele: 105, hr: 170 },
  { sec: 100, lat: 12.907, ele: 104, hr: 180 },
];

describe("GPX: Garmin style", () => {
  const xml = gpx(
    `<trk><name>Morning Run</name><type>running</type><trkseg>${gpxPts(garminPts)}</trkseg></trk>`,
    `<metadata><name>Ignored when trk has name</name></metadata>`,
  );
  it("extracts timing, pause, HR, elevation, distance", () => {
    const [w] = ok(xml);
    expect(w.format).toBe("gpx");
    expect(w.name).toBe("Morning Run");
    expect(w.sportHint).toBe("running");
    expect(w.startTime).toBe("2026-03-10T01:00:00.000Z");
    expect(w.elapsedSec).toBe(100);
    expect(w.movingSec).toBe(60);
    expect(w.avgHr).toBe(150);
    expect(w.maxHr).toBe(180);
    expect(w.hr?.time).toEqual([0, 10, 20, 30, 70, 80, 90, 100]);
    expect(w.hr?.heartrate).toEqual([120, 130, 140, 150, 150, 160, 170, 180]);
    expect(w.elevationGainM).toBe(6);
    expect(w.distanceKm).toBeCloseTo(0.778, 3);
    expect(w.calories).toBeNull();
    expect(w.timeWasAssumed).toBe(false);
    expect(w.warnings).toEqual([]);
  });
  it("detects the format", () => {
    expect(detectFormat(xml)).toBe("gpx");
    expect(detectFormat("﻿" + xml)).toBe("gpx");
  });
});

describe("GPX: Zepp / Amazfit style", () => {
  const pts = [0, 10, 20, 30]
    .map(
      (s, i) =>
        `<trkpt lat="28.6${i}" lon="77.2"><ele>220</ele><time>${isoAt("2026-02-01T00:30:00Z", s)}</time>` +
        `<extensions><ns3:TrackPointExtension><ns3:hr>${100 + i * 10}</ns3:hr></ns3:TrackPointExtension></extensions></trkpt>`,
    )
    .join("");
  const xml = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<metadata><name>Outdoor Running</name></metadata><trk><type>running</type><trkseg>${pts}</trkseg></trk></gpx>`;
  it("handles the ns3:hr prefix and metadata name", () => {
    const [w] = ok(xml);
    expect(w.name).toBe("Outdoor Running");
    expect(w.sportHint).toBe("running");
    expect(w.hr?.heartrate).toEqual([100, 110, 120, 130]);
    expect(w.avgHr).toBe(115);
    expect(w.maxHr).toBe(130);
    expect(w.elapsedSec).toBe(30);
  });
  it("also accepts un-prefixed hr and heartrate", () => {
    const x = gpx(
      `<trk><trkseg>${gpxPts([
        { sec: 0, hr: 100, hrTag: "hr" },
        { sec: 10, hr: 110, hrTag: "heartrate" },
      ])}</trkseg></trk>`,
    );
    expect(ok(x)[0].hr?.heartrate).toEqual([100, 110]);
  });
});

describe("GPX: no HR, no elevation", () => {
  it("returns nulls", () => {
    const [w] = ok(
      gpx(
        `<trk><trkseg>${gpxPts([{ sec: 0 }, { sec: 60, lat: 12.91 }, { sec: 120, lat: 12.92 }])}</trkseg></trk>`,
      ),
    );
    expect(w.hr).toBeNull();
    expect(w.avgHr).toBeNull();
    expect(w.maxHr).toBeNull();
    expect(w.elevationGainM).toBeNull();
    expect(w.name).toBeNull();
    expect(w.sportHint).toBeNull();
    expect(w.distanceKm).toBeCloseTo(2.224, 2);
    expect(w.movingSec).toBe(0 + 120 - 60 - 60);
  });
  it("gives null distance without coordinates", () => {
    const x = `<gpx><trk><trkseg><trkpt><time>2026-03-10T01:00:00Z</time></trkpt><trkpt><time>2026-03-10T01:10:00Z</time></trkpt></trkseg></trk></gpx>`;
    const [w] = ok(x);
    expect(w.distanceKm).toBeNull();
    expect(w.elapsedSec).toBe(600);
  });
});

describe("timestamps", () => {
  const xmlFor = (t1: string, t2: string) =>
    `<gpx><trk><trkseg><trkpt lat="1" lon="1"><time>${t1}</time></trkpt><trkpt lat="1" lon="1"><time>${t2}</time></trkpt></trkseg></trk></gpx>`;
  it("applies assumeTz when there is no zone marker", () => {
    const x = xmlFor("2026-03-10T06:30:00", "2026-03-10T06:40:00");
    const [u] = ok(x);
    const [i] = ok(x, { assumeTz: "ist" });
    expect(u.timeWasAssumed).toBe(true);
    expect(i.timeWasAssumed).toBe(true);
    expect(u.startTime).toBe("2026-03-10T06:30:00.000Z");
    expect(i.startTime).toBe("2026-03-10T01:00:00.000Z");
    expect(Date.parse(u.startTime) - Date.parse(i.startTime)).toBe(
      5.5 * 3600 * 1000,
    );
  });
  it("reads Z, offsets and fractional seconds", () => {
    expect(
      ok(xmlFor("2026-03-10T01:00:00Z", "2026-03-10T01:05:00Z"))[0]
        .timeWasAssumed,
    ).toBe(false);
    expect(
      ok(xmlFor("2026-03-10T06:30:00+05:30", "2026-03-10T06:35:00+05:30"))[0]
        .startTime,
    ).toBe("2026-03-10T01:00:00.000Z");
    expect(
      ok(xmlFor("2026-03-10T00:00:00-0500", "2026-03-10T00:05:00-0500"))[0]
        .startTime,
    ).toBe("2026-03-10T05:00:00.000Z");
    const [f] = ok(
      xmlFor("2026-03-10T01:00:00.250Z", "2026-03-10T01:00:30.750Z"),
    );
    expect(f.startTime).toBe("2026-03-10T01:00:00.250Z");
    expect(f.elapsedSec).toBe(30.5);
  });
});

describe("TCX", () => {
  const tp = (sec: number, hr?: number, dist?: number) =>
    `<Trackpoint><Time>${isoAt("2026-03-10T01:00:00Z", sec)}</Time>` +
    `<Position><LatitudeDegrees>12.9</LatitudeDegrees><LongitudeDegrees>77.6</LongitudeDegrees></Position>` +
    `<AltitudeMeters>900</AltitudeMeters>` +
    (dist !== undefined ? `<DistanceMeters>${dist}</DistanceMeters>` : "") +
    (hr !== undefined
      ? `<HeartRateBpm><Value>${hr}</Value></HeartRateBpm>`
      : "") +
    `</Trackpoint>`;
  const wrap = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities>${body}</Activities></TrainingCenterDatabase>`;

  it("(e) running with two laps", () => {
    const xml = wrap(`<Activity Sport="Running"><Id>2026-03-10T01:00:00Z</Id>
<Lap StartTime="2026-03-10T01:00:00Z"><TotalTimeSeconds>60</TotalTimeSeconds><DistanceMeters>200</DistanceMeters><Calories>10</Calories>
<AverageHeartRateBpm><Value>140</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>150</Value></MaximumHeartRateBpm>
<Track>${tp(0, 130)}${tp(30, 140)}${tp(60, 150)}</Track></Lap>
<Lap StartTime="2026-03-10T01:01:00Z"><TotalTimeSeconds>60</TotalTimeSeconds><DistanceMeters>250</DistanceMeters><Calories>12</Calories>
<AverageHeartRateBpm><Value>160</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>170</Value></MaximumHeartRateBpm>
<Track>${tp(90, 160)}${tp(120, 170)}</Track></Lap></Activity>`);
    expect(detectFormat(xml)).toBe("tcx");
    const ws = ok(xml);
    expect(ws).toHaveLength(1);
    const w = ws[0];
    expect(w.format).toBe("tcx");
    expect(w.sportHint).toBe("Running");
    expect(w.startTime).toBe("2026-03-10T01:00:00.000Z");
    expect(w.elapsedSec).toBe(120);
    expect(w.movingSec).toBe(120);
    expect(w.distanceKm).toBe(0.45);
    expect(w.calories).toBe(22);
    expect(w.avgHr).toBe(150);
    expect(w.maxHr).toBe(170);
    expect(w.hr?.time).toEqual([0, 30, 60, 90, 120]);
    expect(w.hr?.heartrate).toEqual([130, 140, 150, 160, 170]);
  });

  it("(f) biking with lap HR averages only and trackpoint distance fallback", () => {
    const xml = wrap(`<Activity Sport="Biking"><Id>2026-03-10T01:00:00Z</Id>
<Lap StartTime="2026-03-10T01:00:00Z"><TotalTimeSeconds>60</TotalTimeSeconds>
<AverageHeartRateBpm><Value>120</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>140</Value></MaximumHeartRateBpm>
<Track>${tp(0, undefined, 0)}${tp(30, undefined, 400)}</Track></Lap>
<Lap StartTime="2026-03-10T01:01:00Z"><TotalTimeSeconds>60</TotalTimeSeconds>
<AverageHeartRateBpm><Value>140</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>160</Value></MaximumHeartRateBpm>
<Track>${tp(60, undefined, 700)}${tp(90, undefined, 1000)}</Track></Lap></Activity>`);
    const [w] = ok(xml);
    expect(w.sportHint).toBe("Biking");
    expect(w.hr).toBeNull();
    expect(w.avgHr).toBe(130);
    expect(w.maxHr).toBe(160);
    expect(w.distanceKm).toBe(1);
    expect(w.calories).toBeNull();
    expect(w.elapsedSec).toBe(120);
    expect(w.movingSec).toBe(120);
  });

  it("falls back to trackpoints when there are no lap totals", () => {
    const xml = wrap(
      `<Activity Sport="Other"><Id>2026-03-10T01:00:00Z</Id><Lap><Track>${tp(0, 100)}${tp(20, 110)}${tp(40, 120)}</Track></Lap></Activity>`,
    );
    const [w] = ok(xml);
    expect(w.startTime).toBe("2026-03-10T01:00:00.000Z");
    expect(w.elapsedSec).toBe(40);
    expect(w.avgHr).toBe(110);
  });
});

describe("(g) multiple tracks", () => {
  it("returns one workout per trk", () => {
    const xml = gpx(
      `<trk><name>A</name><trkseg>${gpxPts([{ sec: 0 }, { sec: 600 }])}</trkseg></trk>` +
        `<trk><name>B</name><trkseg>${gpxPts([{ sec: 0 }, { sec: 900 }], "2026-03-11T01:00:00Z")}</trkseg></trk>`,
    );
    const ws = ok(xml);
    expect(ws.map((w) => w.name)).toEqual(["A", "B"]);
    expect(ws[1].startTime).toBe("2026-03-11T01:00:00.000Z");
  });
  it("keeps usable tracks and warns about unusable ones", () => {
    const xml = gpx(
      `<trk><name>A</name><trkseg>${gpxPts([{ sec: 0 }, { sec: 600 }])}</trkseg></trk>` +
        `<trk><name>NoTime</name><trkseg><trkpt lat="1" lon="1"></trkpt></trkseg></trk>`,
    );
    const ws = ok(xml);
    expect(ws).toHaveLength(1);
    expect(ws[0].warnings.join(" ")).toMatch(/could not be used/);
  });
});

describe("(h) hostile and broken input", () => {
  it("ignores DOCTYPE entity definitions (billion laughs) without expansion", () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE gpx [
 <!ENTITY lol "lol">
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
 <!ENTITY lol9 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<gpx><trk><name>&lol9; &amp; &#65;&#x42;</name><trkseg>${gpxPts([{ sec: 0 }, { sec: 120 }])}</trkseg></trk></gpx>`;
    const t0 = Date.now();
    const [w] = ok(xml);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(w.name).toBe("&lol9; & AB");
  });

  it("handles 10,000 nested tags without overflowing the stack", () => {
    const n = 10_000;
    const nested = "<a>".repeat(n) + "</a>".repeat(n);
    const r = parseActivityFile(nested);
    expect(r.ok).toBe(false);
    const inGpx = `<gpx><trk>${"<x>".repeat(n)}${gpxPts([{ sec: 0 }, { sec: 120 }])}${"</x>".repeat(n)}</trk></gpx>`;
    expect(ok(inGpx)[0].elapsedSec).toBe(120);
  });

  it("rejects truncated, plain text, empty, HTML, no timestamps", () => {
    const full = gpx(
      `<trk><trkseg>${gpxPts([{ sec: 0 }, { sec: 120 }])}</trkseg></trk>`,
    );
    for (const bad of [
      full.slice(0, Math.floor(full.length / 2)),
      "just some words, not xml",
      "",
      "   \n ",
      "<!DOCTYPE html><html><head><title>x</title></head><body><p>hello<br>world</p></body></html>",
      `<gpx><trk><trkseg><trkpt lat="1" lon="2"><ele>3</ele></trkpt></trkseg></trk></gpx>`,
      `<gpx><wpt lat="1" lon="2"></wpt></gpx>`,
      `<gpx><trk><trkseg><trkpt lat="1" lon="2" `,
    ]) {
      const r = parseActivityFile(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
    }
  });

  it("refuses inputs over 12,000,000 characters", () => {
    const r = parseActivityFile("a".repeat(12_000_001));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too large/);
  });

  it("copes with comments, CDATA, processing instructions, quoted '>' in attributes and single quotes", () => {
    const xml = `${String.fromCharCode(0xfeff)}<?xml version='1.0'?><!-- hi <trk> --><?pi stuff?><gpx creator='a > b'><trk><name><![CDATA[Run <fast> & far]]></name><trkseg>
<trkpt lat='12.9' lon='77.6'><time>2026-03-10T01:00:00Z</time></trkpt><trkpt lat="12.9" lon="77.6"/>
<trkpt lat='12.9' lon='77.6'><time>2026-03-10T01:02:00Z</time></trkpt></trkseg></trk></gpx>`;
    const [w] = ok(xml);
    expect(w.name).toBe("Run <fast> & far");
    expect(w.elapsedSec).toBe(120);
  });
});

describe("(i) heart-rate filtering", () => {
  it("drops 0, 30, 250 and 300 with a warning", () => {
    const [w] = ok(
      gpx(
        `<trk><trkseg>${gpxPts([
          { sec: 0, hr: 0 },
          { sec: 10, hr: 100 },
          { sec: 20, hr: 30 },
          { sec: 30, hr: 250 },
          { sec: 40, hr: 120 },
          { sec: 50, hr: 300 },
          { sec: 60, hr: 140 },
        ])}</trkseg></trk>`,
      ),
    );
    expect(w.hr?.heartrate).toEqual([100, 120, 140]);
    expect(w.hr?.time).toEqual([10, 40, 60]);
    expect(w.maxHr).toBe(140);
    expect(w.warnings).toContain("Some heart-rate readings were ignored.");
  });
  it("gives no HR at all when every reading is invalid", () => {
    const [w] = ok(
      gpx(
        `<trk><trkseg>${gpxPts([
          { sec: 0, hr: 0 },
          { sec: 60, hr: 300 },
        ])}</trkseg></trk>`,
      ),
    );
    expect(w.hr).toBeNull();
    expect(w.avgHr).toBeNull();
    expect(w.warnings).toHaveLength(1);
  });
});

describe("(j) distance", () => {
  it("matches the hand-computed haversine for 0.001 degrees of latitude", () => {
    const [w] = ok(
      gpx(
        `<trk><trkseg>${gpxPts([
          { sec: 0, lat: 10, lon: 20 },
          { sec: 60, lat: 10.001, lon: 20 },
        ])}</trkseg></trk>`,
      ),
    );
    // 6371 km * 0.001 deg * pi/180 = 0.11119 km
    expect(w.distanceKm).toBeCloseTo(0.1112, 3);
  });
  it("ignores jumps over 5 km and continues from the new point", () => {
    const [w] = ok(
      gpx(
        `<trk><trkseg>${gpxPts([
          { sec: 0, lat: 10, lon: 20 },
          { sec: 10, lat: 10.001, lon: 20 },
          { sec: 20, lat: 11.001, lon: 20 }, // ~111 km jump
          { sec: 30, lat: 11.002, lon: 20 },
        ])}</trkseg></trk>`,
      ),
    );
    expect(w.distanceKm).toBeCloseTo(0.2224, 3);
  });
  it("skips points with missing coordinates", () => {
    const x = `<gpx><trk><trkseg>
<trkpt lat="10" lon="20"><time>2026-03-10T01:00:00Z</time></trkpt>
<trkpt><time>2026-03-10T01:00:10Z</time></trkpt>
<trkpt lat="10.001" lon="20"><time>2026-03-10T01:00:20Z</time></trkpt></trkseg></trk></gpx>`;
    expect(ok(x)[0].distanceKm).toBeCloseTo(0.1112, 3);
  });
});

describe("(k) elevation gain smoothing", () => {
  const gain = (eles: number[]) =>
    ok(
      gpx(
        `<trk><trkseg>${gpxPts(eles.map((e, i) => ({ sec: i * 10, ele: e })))}</trkseg></trk>`,
      ),
    )[0].elevationGainM;
  it("ignores wobble under 1 m", () => {
    expect(gain([100, 100.5, 100, 100.6, 100.2, 100.9])).toBe(0);
  });
  it("counts real climbs only", () => {
    expect(gain([100, 105, 103, 110])).toBe(12);
  });
  it("is null with no elevation and 0 for a descent", () => {
    expect(gain([200, 190, 180])).toBe(0);
  });
});

describe("(l) validateParsedWorkout", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const base: ParsedWorkout = {
    format: "gpx",
    name: null,
    sportHint: null,
    startTime: "2026-06-01T10:00:00.000Z",
    elapsedSec: 1800,
    movingSec: 1700,
    distanceKm: 3,
    avgHr: null,
    maxHr: null,
    calories: null,
    elevationGainM: null,
    hr: null,
    timeWasAssumed: false,
    warnings: [],
  };
  it("accepts a valid workout", () => {
    expect(validateParsedWorkout(base, now)).toEqual([]);
  });
  it("rejects under 1 minute and uses moving time", () => {
    expect(
      validateParsedWorkout({ ...base, elapsedSec: 30, movingSec: null }, now),
    ).toHaveLength(1);
    expect(
      validateParsedWorkout({ ...base, elapsedSec: 0, movingSec: 0 }, now)[0],
    ).toMatch(/shorter than 1 minute/);
    expect(
      validateParsedWorkout({ ...base, elapsedSec: 1800, movingSec: 59 }, now),
    ).toHaveLength(1);
    expect(
      validateParsedWorkout({ ...base, elapsedSec: 60, movingSec: 60 }, now),
    ).toEqual([]);
  });
  it("rejects over 600 minutes", () => {
    expect(
      validateParsedWorkout(
        { ...base, elapsedSec: 601 * 60, movingSec: null },
        now,
      )[0],
    ).toMatch(/600 minutes/);
    expect(
      validateParsedWorkout(
        { ...base, elapsedSec: 600 * 60, movingSec: null },
        now,
      ),
    ).toEqual([]);
  });
  it("rejects more than 24 hours elapsed", () => {
    const p = validateParsedWorkout(
      { ...base, elapsedSec: 25 * 3600, movingSec: 3600 },
      now,
    );
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/24 hours/);
  });
  it("rejects a start more than 5 minutes in the future", () => {
    expect(
      validateParsedWorkout(
        { ...base, startTime: "2026-06-01T12:04:00.000Z" },
        now,
      ),
    ).toEqual([]);
    expect(
      validateParsedWorkout(
        { ...base, startTime: "2026-06-01T12:06:00.000Z" },
        now,
      )[0],
    ).toMatch(/future/);
  });
  it("rejects non-finite values", () => {
    expect(
      validateParsedWorkout({ ...base, elapsedSec: NaN, movingSec: null }, now),
    ).toHaveLength(1);
    expect(
      validateParsedWorkout({ ...base, startTime: "garbage" }, now),
    ).toHaveLength(1);
  });
});

describe("(m) deterministicActivityId", () => {
  const w: ParsedWorkout = {
    format: "gpx",
    name: null,
    sportHint: null,
    startTime: "2026-03-10T01:00:00.000Z",
    elapsedSec: 1800.4,
    movingSec: null,
    distanceKm: 5.2,
    avgHr: null,
    maxHr: null,
    calories: null,
    elevationGainM: null,
    hr: null,
    timeWasAssumed: false,
    warnings: [],
  };
  it("is a stable RFC 4122 v5-style UUID", async () => {
    const a = await deterministicActivityId("user-1", w);
    const b = await deterministicActivityId("user-1", {
      ...w,
      name: "different name does not matter",
    });
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it("changes when user, start, rounded elapsed or distance change", async () => {
    const a = await deterministicActivityId("user-1", w);
    const ids = await Promise.all([
      deterministicActivityId("user-2", w),
      deterministicActivityId("user-1", {
        ...w,
        startTime: "2026-03-10T01:00:01.000Z",
      }),
      deterministicActivityId("user-1", { ...w, elapsedSec: 1801 }),
      deterministicActivityId("user-1", { ...w, distanceKm: 5.3 }),
      deterministicActivityId("user-1", { ...w, distanceKm: null }),
    ]);
    for (const id of ids) expect(id).not.toBe(a);
    expect(new Set(ids).size).toBe(ids.length);
    // 1800.4 and 1800.0 round to the same second
    expect(
      await deterministicActivityId("user-1", { ...w, elapsedSec: 1800 }),
    ).toBe(a);
  });
});

describe("(n) mapFileSport", () => {
  const cases: Array<[string | null, string]> = [
    ["running", "Running"],
    ["Run", "Running"],
    ["Trail Running", "Running"],
    ["treadmill", "Running"],
    ["Sport=Running", "Running"],
    ["  RUNNING ", "Running"],
    ["walking", "Walking"],
    ["Hiking", "Walking"],
    ["brisk walking", "Brisk walking"],
    ["fast walking", "Brisk walking"],
    ["Biking", "Cycling"],
    ["cycling", "Cycling"],
    ["mountain biking", "Cycling"],
    ["indoor cycling", "Cycling"],
    ["ride", "Cycling"],
    ["pool swim", "Swimming"],
    ["open water", "Swimming"],
    ["yoga", "Yoga"],
    ["strength training", "Gym / Strength training"],
    ["gym", "Gym / Strength training"],
    ["hiit", "HIIT"],
    ["elliptical", "Stair climbing"],
    ["stair stepper", "Stair climbing"],
    ["jump rope", "Skipping"],
    ["badminton", "Badminton"],
    ["tennis", "Tennis"],
    ["soccer", "Football"],
    ["cricket", "Cricket"],
    ["dance", "Dance"],
    ["household chores", "Household chores"],
  ];
  it.each(cases)("%s -> %s", (hint, name) => {
    expect(mapFileSport(hint)).toEqual({ typeName: name, custom: null });
  });
  it("maps unknown and empty hints to Other", () => {
    expect(mapFileSport("rock climbing")).toEqual({
      typeName: "Other",
      custom: "Rock Climbing",
    });
    expect(mapFileSport("")).toEqual({ typeName: "Other", custom: "Workout" });
    expect(mapFileSport(null)).toEqual({
      typeName: "Other",
      custom: "Workout",
    });
    expect(mapFileSport("1")).toEqual({ typeName: "Other", custom: "Workout" });
    expect(mapFileSport("Other")).toEqual({
      typeName: "Other",
      custom: "Workout",
    });
  });
});

describe("(o) buildImportRow", () => {
  const typeIdByName: Record<string, number> = {
    Running: 3,
    Other: 18,
    Cycling: 4,
  };
  const metByTypeId = {
    3: { met_light: 7, met_moderate: 9.8, met_vigorous: 11.5 },
    4: { met_light: 5.8, met_moderate: 8, met_vigorous: 10 },
    18: { met_light: 3, met_moderate: 4, met_vigorous: 6 },
  };
  const ctx = {
    userId: "u1",
    id: "id1",
    fileName: "run.gpx",
    typeIdByName,
    metByTypeId,
    weightKg: 70 as number | null,
    maxHr: 190 as number | null,
  };
  const w: ParsedWorkout = {
    format: "tcx",
    name: "Lunch run",
    sportHint: "Running",
    startTime: "2026-03-10T01:00:00.000Z",
    elapsedSec: 1900,
    movingSec: 1800,
    distanceKm: 5.0004,
    avgHr: 150.4,
    maxHr: 172.6,
    calories: null,
    elevationGainM: null,
    hr: null,
    timeWasAssumed: false,
    warnings: [],
  };

  it("uses file calories as-is and not estimated", () => {
    const r = buildImportRow({ ...w, calories: 321 }, ctx);
    expect(r.calories).toBe(321);
    expect(r.calories_estimated).toBe(false);
    expect(r.source).toBe("manual");
    expect(r.activity_type_id).toBe(3);
    expect(r.custom_name).toBeNull();
    expect(r.duration_min).toBe(30);
    expect(r.distance_km).toBe(5);
    expect(r.avg_hr).toBe(150);
    expect(r.max_hr).toBe(173);
    expect(r.notes).toBe("Imported from run.gpx (Lunch run)");
    expect(r.start_time).toBe(w.startTime);
    expect(r.id).toBe("id1");
    expect(r.user_id).toBe("u1");
  });
  it("estimates by MET with weight (hand-checked)", () => {
    // 150.4/190 = 0.79 -> moderate (<0.8): MET 9.8 * 70 kg * 30 min / 60 = 343
    const r = buildImportRow(w, ctx);
    expect(r.intensity).toBe("moderate");
    expect(r.calories).toBe(343);
    expect(r.calories_estimated).toBe(true);
    // avg 160 / 190 = 0.84 -> vigorous: 11.5 * 70 * 0.5 = 402.5 -> 403
    const v = buildImportRow({ ...w, avgHr: 160 }, ctx);
    expect(v.intensity).toBe("vigorous");
    expect(v.calories).toBe(403);
  });
  it("leaves calories null (estimated) without weight", () => {
    const r = buildImportRow(w, { ...ctx, weightKg: null });
    expect(r.calories).toBeNull();
    expect(r.calories_estimated).toBe(true);
  });
  it("uses a custom name for Other", () => {
    const r = buildImportRow({ ...w, sportHint: "rock climbing" }, ctx);
    expect(r.activity_type_id).toBe(18);
    expect(r.custom_name).toBe("Rock Climbing");
    expect(buildImportRow({ ...w, sportHint: null }, ctx).custom_name).toBe(
      "Workout",
    );
  });
  it("truncates long workout names in the notes to 200 characters", () => {
    const r = buildImportRow({ ...w, name: "x".repeat(500) }, ctx);
    expect(r.notes.length).toBe(200);
    expect(r.notes.startsWith("Imported from run.gpx (xxx")).toBe(true);
  });
  it("nulls HR outside 40..220 and defaults intensity to moderate", () => {
    const r = buildImportRow({ ...w, avgHr: 30, maxHr: 250 }, ctx);
    expect(r.avg_hr).toBeNull();
    expect(r.max_hr).toBeNull();
    expect(r.intensity).toBe("moderate");
    expect(
      buildImportRow({ ...w, avgHr: null, maxHr: null }, ctx).avg_hr,
    ).toBeNull();
  });
  it("clamps duration to 1..600 and falls back to elapsed", () => {
    expect(
      buildImportRow({ ...w, movingSec: null, elapsedSec: 10 }, ctx)
        .duration_min,
    ).toBe(1);
    expect(
      buildImportRow({ ...w, movingSec: null, elapsedSec: 700 * 60 }, ctx)
        .duration_min,
    ).toBe(600);
    expect(
      buildImportRow({ ...w, movingSec: null, elapsedSec: 1800 }, ctx)
        .duration_min,
    ).toBe(30);
  });
});

describe("(p) hrZoneSecondsForWorkout", () => {
  const base: ParsedWorkout = {
    format: "gpx",
    name: null,
    sportHint: null,
    startTime: "2026-03-10T01:00:00.000Z",
    elapsedSec: 40,
    movingSec: 40,
    distanceKm: null,
    avgHr: null,
    maxHr: null,
    calories: null,
    elevationGainM: null,
    hr: null,
    timeWasAssumed: false,
    warnings: [],
  };
  it("returns null without HR", () => {
    expect(hrZoneSecondsForWorkout(base, 200)).toBeNull();
    expect(
      hrZoneSecondsForWorkout(
        { ...base, hr: { time: [], heartrate: [] } },
        200,
      ),
    ).toBeNull();
  });
  it("sums seconds per zone (max HR 200: zone tops 120/140/160/180/200)", () => {
    const w = {
      ...base,
      hr: { time: [0, 10, 20, 30], heartrate: [100, 130, 150, 190] },
    };
    expect(hrZoneSecondsForWorkout(w, 200)).toEqual([10, 10, 10, 0, 10]);
  });
  it("works end to end from a parsed file", () => {
    const [p] = ok(
      gpx(
        `<trk><trkseg>${gpxPts([
          { sec: 0, hr: 100 },
          { sec: 10, hr: 130 },
          { sec: 20, hr: 150 },
          { sec: 30, hr: 190 },
        ])}</trkseg></trk>`,
      ),
    );
    expect(hrZoneSecondsForWorkout(p, 200)).toEqual([10, 10, 10, 0, 10]);
  });
});

describe("review regressions", () => {
  const ptXml = (lat: number, t: string) =>
    `<trkpt lat="${lat}" lon="1"><time>${t}</time></trkpt>`;
  const blank: ParsedWorkout = {
    format: "gpx",
    name: null,
    sportHint: null,
    startTime: "2026-03-10T01:00:00.000Z",
    elapsedSec: 1800,
    movingSec: 1800,
    distanceKm: null,
    avgHr: null,
    maxHr: null,
    calories: null,
    elevationGainM: null,
    hr: null,
    timeWasAssumed: false,
    warnings: [],
  };

  it("1: deeply nested <trk> is linear and does not duplicate points", () => {
    // 40,000 levels: a quadratic implementation needs many seconds here (about 13 s measured by extrapolation from
    // 8,000 levels = 552 ms), a linear one well under one. The generous bound keeps the test stable on a loaded machine.
    const n = 40000;
    const pts =
      ptXml(1, "2026-03-10T01:00:00Z") + ptXml(1.001, "2026-03-10T01:10:00Z");
    const xml = `<gpx>${"<trk>".repeat(n)}${pts}${"</trk>".repeat(n)}</gpx>`;
    const t0 = Date.now();
    const ws = ok(xml);
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(ws).toHaveLength(1);
    expect(ws[0].elapsedSec).toBe(600);
    expect(ws[0].distanceKm).toBeCloseTo(0.1112, 3);
  });
  it("1: nested TCX Activity and Lap are not double counted", () => {
    const tp = (s: number) =>
      `<Trackpoint><Time>${isoAt("2026-03-10T01:00:00Z", s)}</Time><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>`;
    const xml = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-03-10T01:00:00Z</Id>
<Lap StartTime="2026-03-10T01:00:00Z"><Lap><Track>${tp(0)}${tp(30)}</Track></Lap></Lap>
<Activity Sport="Biking"><Lap><Track>${tp(60)}</Track></Lap></Activity></Activity></Activities></TrainingCenterDatabase>`;
    const ws = ok(xml);
    expect(ws).toHaveLength(1);
    expect(ws[0].hr?.heartrate).toHaveLength(3);
  });

  it("2: caps the number of elements", () => {
    const r = parseActivityFile(`<gpx>${"<a/>".repeat(500_001)}</gpx>`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too many elements/);
    const small = parseActivityFile(`<gpx>${"<a/>".repeat(1000)}</gpx>`);
    expect(small.ok).toBe(false);
    if (!small.ok) expect(small.error).not.toMatch(/too many/);
  });

  it("3: HR zone seconds are whole numbers", () => {
    const w = {
      ...blank,
      hr: { time: [0, 1.3, 2.6], heartrate: [100, 130, 150] },
    };
    const z = hrZoneSecondsForWorkout(w, 200) as number[];
    expect(z.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
    expect(z).toEqual([1, 1, 1, 0, 0]);
    expect(Math.abs(z.reduce((a, b) => a + b, 0) - 3.9)).toBeLessThanOrEqual(2);
  });

  it("4: rejects invalid calendar dates and bad offsets, handles early years", () => {
    const xmlFor = (t: string) =>
      `<gpx><trk><trkseg><trkpt lat="1" lon="1"><time>${t}</time></trkpt><trkpt lat="1" lon="1"><time>2024-03-10T01:05:00Z</time></trkpt></trkseg></trk></gpx>`;
    const bad = [
      "2024-02-31T10:00:00Z",
      "2023-02-29T10:00:00Z",
      "2024-04-31T10:00:00Z",
      "2024-03-10T24:00:01Z",
      "2024-03-10T25:00:00Z",
      "2024-03-10T10:00:00+15:00",
      "2024-03-10T10:00:00+05:75",
    ];
    for (const t of bad) {
      const ws = ok(xmlFor(t));
      expect(ws[0].startTime).toBe("2024-03-10T01:05:00.000Z");
      expect(ws[0].warnings).toContain(
        "Some timestamps could not be read and were ignored.",
      );
    }
    expect(ok(xmlFor("2024-02-29T10:00:00Z"))[0].startTime).toBe(
      "2024-02-29T10:00:00.000Z",
    );
    expect(ok(xmlFor("0050-03-10T10:00:00Z"))[0].startTime).toBe(
      "0050-03-10T10:00:00.000Z",
    );
    expect(ok(xmlFor("2024-03-10T10:00:00+14:00"))[0].startTime).toBe(
      "2024-03-09T20:00:00.000Z",
    );
  });

  it("5: validate rejects years before 2000", () => {
    const w = ok(
      gpx(
        `<trk><trkseg>${gpxPts([{ sec: 0 }, { sec: 600 }], "1970-01-01T00:00:00Z")}</trkseg></trk>`,
      ),
    )[0];
    expect(
      validateParsedWorkout(w, new Date("2026-06-01T00:00:00Z")),
    ).toContain("The date in this file looks wrong (before 2000).");
  });

  it("6: unquoted attribute before /> self-closes", () => {
    const xml = `<gpx><trk><trkseg><trkpt lat=1 lon=2/><trkpt lat=1 lon=2><time>2026-03-10T01:00:00Z</time></trkpt><trkpt lat=1 lon=2/><trkpt lat="1" lon="2"><time>2026-03-10T01:10:00Z</time></trkpt></trkseg></trk></gpx>`;
    expect(ok(xml)[0].elapsedSec).toBe(600);
  });

  it("7: mapFileSport word boundaries and ordering", () => {
    const t = (h: string) => mapFileSport(h).typeName;
    expect(t("stride")).toBe("Other");
    expect(t("Stride training")).toBe("Other");
    expect(t("skipper")).toBe("Other");
    expect(t("skip")).toBe("Skipping");
    expect(t("Treadmill walking")).toBe("Walking");
    expect(t("Walking (Treadmill)")).toBe("Walking");
    expect(t("Treadmill")).toBe("Running");
    expect(t("Treadmill running")).toBe("Running");
    expect(mapFileSport("Other")).toEqual({
      typeName: "Other",
      custom: "Workout",
    });
    expect(mapFileSport("Generic")).toEqual({
      typeName: "Other",
      custom: "Workout",
    });
  });

  it("8: buildImportRow keeps the mapped name when the type id is missing", () => {
    const r = buildImportRow(
      { ...blank, sportHint: "cycling" },
      {
        userId: "u",
        id: "i",
        fileName: "f.gpx",
        typeIdByName: { Other: 18 },
        metByTypeId: {},
        weightKg: null,
        maxHr: null,
      },
    );
    expect(r.activity_type_id).toBe(18);
    expect(r.custom_name).toBe("Cycling");
  });

  it("9: slices a huge sport hint", () => {
    const big = "x".repeat(1_000_000);
    const g = ok(
      gpx(
        `<trk><type>${big}</type><trkseg>${gpxPts([{ sec: 0 }, { sec: 600 }])}</trkseg></trk>`,
      ),
    );
    expect(g[0].sportHint).toHaveLength(200);
    const tcx = `<TrainingCenterDatabase><Activities><Activity Sport="${big}"><Id>2026-03-10T01:00:00Z</Id><Lap><TotalTimeSeconds>600</TotalTimeSeconds></Lap></Activity></Activities></TrainingCenterDatabase>`;
    expect(ok(tcx)[0].sportHint).toHaveLength(200);
  });
});
