/**
 * Activity file import (GPX / TCX): a small tolerant XML tag scanner plus extraction rules.
 * Pure TypeScript, no dependencies, no DOM. No entity expansion beyond the five predefined
 * ones and numeric references; DOCTYPE / ENTITY declarations are skipped completely.
 */
import type {
  ActivityFileFormat,
  ImportActivityUpsert,
  ParsedWorkout,
  ParseOptions,
  ParseResult,
} from "./importTypes";
import type { StravaHrStream } from "./stravaTypes";
import { metForIntensity, metKcal } from "./calc";
import { intensityFromHr, timeInHrZones } from "./strava";

const MAX_CHARS = 12_000_000;
const MAX_NODES = 3_000_000;
const MAX_GAP_S = 30;
const MIN_HR = 40;
const MAX_HR = 220;
const JUMP_KM = 5;
const EARTH_R_KM = 6371;

/* ------------------------------------------------------------------ XML scanner */

interface XNode {
  name: string; // local name
  attrs: Record<string, string>;
  text: string;
  children: XNode[];
  parent: XNode | null;
}

class ScanError extends Error {}

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;

function decodeEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(ENTITY_RE, (m, body: string) => {
    switch (body) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
    }
    const cp =
      body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
    if (
      !Number.isFinite(cp) ||
      cp <= 0 ||
      cp > 0x10ffff ||
      (cp >= 0xd800 && cp <= 0xdfff)
    )
      return m;
    return String.fromCodePoint(cp);
  });
}

function localName(n: string): string {
  const i = n.lastIndexOf(":");
  return i >= 0 ? n.slice(i + 1) : n;
}

function isWs(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

/** Iterative scan; returns a virtual root whose children are the top-level elements. */
function scanXml(input: string): XNode {
  let src = input;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const len = src.length;
  const root: XNode = {
    name: "#root",
    attrs: {},
    text: "",
    children: [],
    parent: null,
  };
  let cur = root;
  let depth = 0;
  let nodes = 0;
  const openCounts = new Map<string, number>();
  let pos = 0;

  const addText = (t: string) => {
    if (cur !== root && t.length > 0) cur.text += t;
  };

  while (pos < len) {
    const lt = src.indexOf("<", pos);
    if (lt < 0) {
      addText(decodeEntities(src.slice(pos)));
      pos = len;
      break;
    }
    if (lt > pos) addText(decodeEntities(src.slice(pos, lt)));
    pos = lt;

    if (src.startsWith("<!--", pos)) {
      const end = src.indexOf("-->", pos + 4);
      if (end < 0) throw new ScanError("unterminated comment");
      pos = end + 3;
    } else if (src.startsWith("<![CDATA[", pos)) {
      const end = src.indexOf("]]>", pos + 9);
      if (end < 0) throw new ScanError("unterminated CDATA");
      addText(src.slice(pos + 9, end));
      pos = end + 3;
    } else if (src.startsWith("<?", pos)) {
      const end = src.indexOf("?>", pos + 2);
      if (end < 0) throw new ScanError("unterminated processing instruction");
      pos = end + 2;
    } else if (src.startsWith("<!", pos)) {
      // DOCTYPE (possibly with an internal subset in brackets) or other declaration: skip entirely.
      let i = pos + 2;
      let bracket = 0;
      let quote = 0;
      let done = false;
      while (i < len) {
        const c = src.charCodeAt(i);
        if (quote) {
          if (c === quote) quote = 0;
        } else if (c === 34 || c === 39) {
          quote = c;
        } else if (c === 91) {
          bracket++;
        } else if (c === 93) {
          if (bracket > 0) bracket--;
        } else if (c === 60 && src.startsWith("<!--", i)) {
          const e = src.indexOf("-->", i + 4);
          if (e < 0) throw new ScanError("unterminated comment");
          i = e + 2;
        } else if (c === 62 && bracket === 0) {
          done = true;
          break;
        }
        i++;
      }
      if (!done) throw new ScanError("unterminated declaration");
      pos = i + 1;
    } else if (src.charCodeAt(pos + 1) === 47) {
      // closing tag
      const end = src.indexOf(">", pos + 2);
      if (end < 0) throw new ScanError("unterminated closing tag");
      const name = localName(src.slice(pos + 2, end).trim());
      pos = end + 1;
      if ((openCounts.get(name) ?? 0) > 0) {
        while (cur !== root) {
          const closing = cur;
          cur = cur.parent as XNode;
          depth--;
          openCounts.set(closing.name, (openCounts.get(closing.name) ?? 1) - 1);
          if (closing.name === name) break;
        }
      }
      // else: stray closing tag, ignored
    } else {
      // start tag
      let i = pos + 1;
      const nameStart = i;
      while (i < len) {
        const c = src.charCodeAt(i);
        if (isWs(c) || c === 62 || c === 47) break;
        i++;
      }
      const rawName = src.slice(nameStart, i);
      if (rawName.length === 0) {
        // a lone "<" in text: treat as text
        addText("<");
        pos = pos + 1;
        continue;
      }
      const attrs: Record<string, string> = {};
      let selfClose = false;
      let closed = false;
      while (i < len) {
        while (i < len && isWs(src.charCodeAt(i))) i++;
        if (i >= len) break;
        const c = src.charCodeAt(i);
        if (c === 62) {
          i++;
          closed = true;
          break;
        }
        if (c === 47) {
          selfClose = true;
          i++;
          continue;
        }
        const aStart = i;
        while (i < len) {
          const d = src.charCodeAt(i);
          if (isWs(d) || d === 61 || d === 62 || d === 47) break;
          i++;
        }
        const aName = localName(src.slice(aStart, i));
        while (i < len && isWs(src.charCodeAt(i))) i++;
        let value = "";
        if (src.charCodeAt(i) === 61) {
          i++;
          while (i < len && isWs(src.charCodeAt(i))) i++;
          const q = src.charCodeAt(i);
          if (q === 34 || q === 39) {
            const qe = src.indexOf(q === 34 ? '"' : "'", i + 1);
            if (qe < 0) throw new ScanError("unterminated attribute");
            value = src.slice(i + 1, qe);
            i = qe + 1;
          } else {
            const vs = i;
            while (i < len) {
              const d = src.charCodeAt(i);
              if (isWs(d) || d === 62) break;
              i++;
            }
            value = src.slice(vs, i);
          }
        } else if (i === aStart) {
          i++; // safety: never stall on an unexpected character
        }
        if (aName && !(aName in attrs)) attrs[aName] = decodeEntities(value);
        selfClose = false;
      }
      if (!closed) throw new ScanError("unterminated tag");
      pos = i;
      if (++nodes > MAX_NODES) throw new ScanError("too many elements");
      const node: XNode = {
        name: localName(rawName),
        attrs,
        text: "",
        children: [],
        parent: cur,
      };
      cur.children.push(node);
      if (!selfClose) {
        cur = node;
        depth++;
        openCounts.set(node.name, (openCounts.get(node.name) ?? 0) + 1);
      }
    }
  }
  if (cur !== root || depth !== 0) throw new ScanError("unclosed elements");
  return root;
}

/** All descendants (not the node itself) in document order, iteratively. */
function descendants(node: XNode, name?: string): XNode[] {
  const out: XNode[] = [];
  const stack: XNode[] = [];
  for (let i = node.children.length - 1; i >= 0; i--)
    stack.push(node.children[i]);
  while (stack.length) {
    const n = stack.pop() as XNode;
    if (name === undefined || n.name === name) out.push(n);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  return out;
}

function child(node: XNode, name: string): XNode | null {
  for (const c of node.children) if (c.name === name) return c;
  return null;
}

function childText(node: XNode, name: string): string | null {
  const c = child(node, name);
  if (!c) return null;
  const t = c.text.trim();
  return t.length ? t : null;
}

function num(s: string | null | undefined): number {
  if (s == null) return NaN;
  const t = s.trim();
  if (t === "") return NaN;
  return Number(t);
}

/* ------------------------------------------------------------------ time */

const TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

interface TimeVal {
  ms: number;
  assumed: boolean;
}

function parseTime(
  s: string | null | undefined,
  assumeTz: "utc" | "ist",
): TimeVal | null {
  if (!s) return null;
  const m = TIME_RE.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se, frac, zone] = m;
  const month = Number(mo);
  const day = Number(d);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    Number(h) > 23 ||
    Number(mi) > 59 ||
    Number(se) > 60
  ) {
    return null;
  }
  let ms = Date.UTC(
    Number(y),
    month - 1,
    day,
    Number(h),
    Number(mi),
    Number(se),
  );
  if (frac) ms += Math.round(Number(`0.${frac}`) * 1000);
  let offsetMin = 0;
  let assumed = false;
  if (!zone) {
    assumed = true;
    offsetMin = assumeTz === "ist" ? 330 : 0;
  } else if (zone.toUpperCase() !== "Z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    const oh = Number(digits.slice(0, 2));
    const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    offsetMin = sign * (oh * 60 + om);
  }
  ms -= offsetMin * 60_000;
  if (!Number.isFinite(ms)) return null;
  return { ms, assumed };
}

/* ------------------------------------------------------------------ shared maths */

interface Pt {
  t: number | null; // epoch ms
  lat: number;
  lon: number;
  ele: number;
  hr: number;
  distM: number; // cumulative metres from the file (TCX), NaN when absent
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function validCoord(p: Pt): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180
  );
}

/** Summed haversine distance, ignoring jumps over 5 km; null without at least 2 usable coordinates. */
function distanceFromCoords(pts: Pt[]): number | null {
  let total = 0;
  let prev: Pt | null = null;
  let used = 0;
  for (const p of pts) {
    if (!validCoord(p)) continue;
    used++;
    if (prev) {
      const d = haversineKm(prev.lat, prev.lon, p.lat, p.lon);
      if (d <= JUMP_KM) total += d;
    }
    prev = p;
  }
  return used >= 2 ? total : null;
}

/** Positive elevation change, ignoring movements under 1 m (hysteresis against a reference level). */
function elevationGain(pts: Pt[]): number | null {
  let ref: number | null = null;
  let gain = 0;
  let any = false;
  for (const p of pts) {
    if (!Number.isFinite(p.ele)) continue;
    any = true;
    if (ref === null) {
      ref = p.ele;
      continue;
    }
    const diff = p.ele - ref;
    if (diff >= 1) {
      gain += diff;
      ref = p.ele;
    } else if (diff <= -1) {
      ref = p.ele;
    }
  }
  return any ? Math.round(gain * 10) / 10 : null;
}

interface HrSummary {
  stream: StravaHrStream | null;
  avg: number | null;
  max: number | null;
  dropped: boolean;
}

function summariseHr(pts: Pt[], startMs: number): HrSummary {
  const t: number[] = [];
  const hr: number[] = [];
  let dropped = false;
  for (const p of pts) {
    if (p.t === null || !Number.isFinite(p.hr)) continue;
    if (p.hr < MIN_HR || p.hr > MAX_HR) {
      dropped = true;
      continue;
    }
    t.push(Math.round(p.t - startMs) / 1000);
    hr.push(p.hr);
  }
  if (hr.length === 0) return { stream: null, avg: null, max: null, dropped };
  let wsum = 0;
  let sum = 0;
  let lastW = 1;
  for (let i = 0; i < hr.length; i++) {
    let w: number;
    if (i < hr.length - 1) {
      w = Math.min(Math.max(t[i + 1] - t[i], 0), MAX_GAP_S);
      lastW = w;
    } else {
      w = hr.length === 1 ? 1 : lastW;
    }
    wsum += w;
    sum += hr[i] * w;
  }
  const avg = wsum > 0 ? sum / wsum : hr.reduce((a, b) => a + b, 0) / hr.length;
  let max = hr[0];
  for (const v of hr) if (v > max) max = v;
  return {
    stream: { time: t, heartrate: hr },
    avg: Math.round(avg * 10) / 10,
    max,
    dropped,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/* ------------------------------------------------------------------ GPX */

function gpxPoint(
  node: XNode,
  assumeTz: "utc" | "ist",
): { pt: Pt; assumed: boolean } {
  const time = parseTime(childText(node, "time"), assumeTz);
  let hr = NaN;
  const ext = child(node, "extensions");
  if (ext) {
    const hrNodes = descendants(ext, "hr");
    const hn = hrNodes.length ? hrNodes : descendants(ext, "heartrate");
    if (hn.length) hr = num(hn[0].text);
  }
  if (!Number.isFinite(hr)) {
    const direct = child(node, "hr") ?? child(node, "heartrate");
    if (direct) hr = num(direct.text);
  }
  return {
    pt: {
      t: time ? time.ms : null,
      lat: num(node.attrs.lat),
      lon: num(node.attrs.lon),
      ele: num(childText(node, "ele")),
      hr,
      distM: NaN,
    },
    assumed: !!time && time.assumed,
  };
}

interface Extracted {
  workouts: ParsedWorkout[];
  skipped: number;
}

function parseGpx(root: XNode, opts: ParseOptions): Extracted {
  const assumeTz = opts.assumeTz ?? "utc";
  const meta = child(root, "metadata");
  const metaName = meta ? childText(meta, "name") : null;
  const trks = descendants(root, "trk");
  const workouts: ParsedWorkout[] = [];
  let skipped = 0;
  for (const trk of trks) {
    const pts: Pt[] = [];
    let assumed = false;
    for (const tp of descendants(trk, "trkpt")) {
      const r = gpxPoint(tp, assumeTz);
      pts.push(r.pt);
      if (r.assumed) assumed = true;
    }
    const w = buildWorkout({
      format: "gpx",
      pts,
      name: childText(trk, "name") ?? (trks.length === 1 ? metaName : null),
      sportHint: childText(trk, "type"),
      assumed,
      fileDistanceKm: null,
      fileElapsedSec: null,
      fileStartMs: null,
      calories: null,
      lapAvgHr: null,
      lapMaxHr: null,
    });
    if (w) workouts.push(w);
    else skipped++;
  }
  return { workouts, skipped };
}

/* ------------------------------------------------------------------ TCX */

function tcxPoint(
  node: XNode,
  assumeTz: "utc" | "ist",
): { pt: Pt; assumed: boolean } {
  const time = parseTime(childText(node, "Time"), assumeTz);
  const hrNode = child(node, "HeartRateBpm");
  const pos = child(node, "Position");
  return {
    pt: {
      t: time ? time.ms : null,
      lat: pos ? num(childText(pos, "LatitudeDegrees")) : NaN,
      lon: pos ? num(childText(pos, "LongitudeDegrees")) : NaN,
      ele: num(childText(node, "AltitudeMeters")),
      hr: hrNode ? num(childText(hrNode, "Value") ?? hrNode.text) : NaN,
      distM: num(childText(node, "DistanceMeters")),
    },
    assumed: !!time && time.assumed,
  };
}

function valueOf(n: XNode | null): number {
  return n ? num(childText(n, "Value") ?? n.text) : NaN;
}

function parseTcx(root: XNode, opts: ParseOptions): Extracted {
  const assumeTz = opts.assumeTz ?? "utc";
  const workouts: ParsedWorkout[] = [];
  let skipped = 0;
  for (const act of descendants(root, "Activity")) {
    const pts: Pt[] = [];
    let assumed = false;
    let totalTime = 0;
    let totalDist = 0;
    let totalCal = 0;
    let firstLapStart: number | null = null;
    const lapAvg: { hr: number; w: number }[] = [];
    let lapMax = NaN;
    for (const lap of descendants(act, "Lap")) {
      const ls = parseTime(lap.attrs.StartTime, assumeTz);
      if (ls && firstLapStart === null) {
        firstLapStart = ls.ms;
        if (ls.assumed) assumed = true;
      }
      const tt = num(childText(lap, "TotalTimeSeconds"));
      if (Number.isFinite(tt) && tt > 0) totalTime += tt;
      const dm = num(childText(lap, "DistanceMeters"));
      if (Number.isFinite(dm) && dm > 0) totalDist += dm;
      const cal = num(childText(lap, "Calories"));
      if (Number.isFinite(cal) && cal > 0) totalCal += cal;
      const av = valueOf(child(lap, "AverageHeartRateBpm"));
      if (Number.isFinite(av) && av >= MIN_HR && av <= MAX_HR) {
        lapAvg.push({ hr: av, w: Number.isFinite(tt) && tt > 0 ? tt : 1 });
      }
      const mx = valueOf(child(lap, "MaximumHeartRateBpm"));
      if (
        Number.isFinite(mx) &&
        mx >= MIN_HR &&
        mx <= MAX_HR &&
        !(mx <= lapMax)
      )
        lapMax = mx;
      for (const tp of descendants(lap, "Trackpoint")) {
        const r = tcxPoint(tp, assumeTz);
        pts.push(r.pt);
        if (r.assumed) assumed = true;
      }
    }
    const idTime = parseTime(childText(act, "Id"), assumeTz);
    if (idTime?.assumed) assumed = true;
    let lapAvgHr: number | null = null;
    if (lapAvg.length) {
      const ws = lapAvg.reduce((a, b) => a + b.w, 0);
      lapAvgHr =
        Math.round((lapAvg.reduce((a, b) => a + b.hr * b.w, 0) / ws) * 10) / 10;
    }
    const w = buildWorkout({
      format: "tcx",
      pts,
      name: null,
      sportHint: act.attrs.Sport ?? null,
      assumed,
      fileDistanceKm: totalDist > 0 ? totalDist / 1000 : null,
      fileElapsedSec: totalTime > 0 ? totalTime : null,
      fileStartMs: idTime ? idTime.ms : firstLapStart,
      calories: totalCal > 0 ? Math.round(totalCal) : null,
      lapAvgHr,
      lapMaxHr: Number.isFinite(lapMax) ? lapMax : null,
    });
    if (w) workouts.push(w);
    else skipped++;
  }
  return { workouts, skipped };
}

/* ------------------------------------------------------------------ common builder */

interface BuildInput {
  format: ActivityFileFormat;
  pts: Pt[];
  name: string | null;
  sportHint: string | null;
  assumed: boolean;
  fileDistanceKm: number | null;
  fileElapsedSec: number | null;
  fileStartMs: number | null;
  calories: number | null;
  lapAvgHr: number | null;
  lapMaxHr: number | null;
}

function buildWorkout(b: BuildInput): ParsedWorkout | null {
  const times: number[] = [];
  for (const p of b.pts) if (p.t !== null) times.push(p.t);
  const startMs = b.fileStartMs ?? (times.length ? times[0] : null);
  if (startMs === null) return null;
  const warnings: string[] = [];

  let pause = 0;
  for (let i = 1; i < times.length; i++) {
    const g = (times[i] - times[i - 1]) / 1000;
    if (g > MAX_GAP_S) pause += g;
  }
  const span =
    times.length >= 2
      ? Math.max(0, (times[times.length - 1] - times[0]) / 1000)
      : 0;

  let elapsed = 0;
  let moving: number | null = null;
  if (b.fileElapsedSec !== null) {
    elapsed = b.fileElapsedSec;
    // Lap timer time may already exclude pauses; only subtract pauses when it covers the whole span.
    if (times.length >= 2)
      moving = elapsed >= span - 1 ? Math.max(0, elapsed - pause) : elapsed;
  } else if (times.length >= 2) {
    elapsed = span;
    moving = Math.max(0, span - pause);
  }

  const hrs = summariseHr(b.pts, startMs);
  if (hrs.dropped) warnings.push("Some heart-rate readings were ignored.");

  const avgHr = hrs.avg ?? b.lapAvgHr;
  const maxHr = hrs.max ?? b.lapMaxHr;

  let distanceKm: number | null = b.fileDistanceKm;
  if (distanceKm === null) {
    const withDist = b.pts.filter((p) => Number.isFinite(p.distM));
    if (withDist.length >= 2) {
      const d =
        (withDist[withDist.length - 1].distM - withDist[0].distM) / 1000;
      if (d > 0) distanceKm = d;
    }
  }
  if (distanceKm === null) distanceKm = distanceFromCoords(b.pts);
  if (distanceKm !== null) distanceKm = round3(distanceKm);

  return {
    format: b.format,
    name: b.name ? b.name.slice(0, 200) : null,
    sportHint: b.sportHint,
    startTime: new Date(startMs).toISOString(),
    elapsedSec: Math.round(elapsed * 1000) / 1000,
    movingSec: moving === null ? null : Math.round(moving * 1000) / 1000,
    distanceKm,
    avgHr,
    maxHr,
    calories: b.calories,
    elevationGainM: elevationGain(b.pts),
    hr: hrs.stream,
    timeWasAssumed: b.assumed,
    warnings,
  };
}

/* ------------------------------------------------------------------ public API */

function formatOf(doc: XNode): ActivityFileFormat | null {
  const r = doc.children[0];
  if (!r) return null;
  const n = r.name.toLowerCase();
  if (n === "gpx") return "gpx";
  if (n === "trainingcenterdatabase") return "tcx";
  return null;
}

export function detectFormat(text: string): ActivityFileFormat | null {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_CHARS)
    return null;
  try {
    return formatOf(scanXml(text));
  } catch {
    return null;
  }
}

export function parseActivityFile(
  text: string,
  opts: ParseOptions = {},
): ParseResult {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, error: "This file is empty." };
  }
  if (text.length > MAX_CHARS) {
    return {
      ok: false,
      error: "This file is too large to read (over 12 million characters).",
    };
  }
  let doc: XNode;
  try {
    doc = scanXml(text);
  } catch {
    return {
      ok: false,
      error:
        "This does not look like a valid GPX or TCX file (it may be damaged or cut off).",
    };
  }
  const fmt = formatOf(doc);
  if (!fmt) {
    return {
      ok: false,
      error:
        "Unknown file type. Only GPX and TCX activity files are supported.",
    };
  }
  const root = doc.children[0];
  const res = fmt === "gpx" ? parseGpx(root, opts) : parseTcx(root, opts);
  if (res.workouts.length === 0) {
    const containers = descendants(
      root,
      fmt === "gpx" ? "trk" : "Activity",
    ).length;
    return {
      ok: false,
      error:
        containers === 0
          ? "No workouts were found in this file."
          : "This file has no timestamps, so the workout cannot be imported.",
    };
  }
  if (res.skipped > 0) {
    res.workouts[0].warnings.push(
      `${res.skipped} workout${res.skipped === 1 ? "" : "s"} in the file could not be used (no timestamps).`,
    );
  }
  return { ok: true, workouts: res.workouts };
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function mapFileSport(hint: string | null): {
  typeName: string;
  custom: string | null;
} {
  let h = (hint ?? "").trim().toLowerCase();
  h = h.replace(/^(sport|type)\s*=\s*/, "").trim();
  const has = (...words: string[]) => words.some((w) => h.includes(w));
  const named = (typeName: string) => ({ typeName, custom: null });
  if (h) {
    if (has("brisk", "fast walk", "power walk")) return named("Brisk walking");
    if (has("cycl", "bik", "ride", "bicycle")) return named("Cycling");
    if (has("run", "jog", "treadmill")) return named("Running");
    if (has("walk", "hik")) return named("Walking");
    if (has("swim", "open water")) return named("Swimming");
    if (has("yoga")) return named("Yoga");
    if (has("hiit", "interval")) return named("HIIT");
    if (has("strength", "gym", "weight", "workout", "fitness"))
      return named("Gym / Strength training");
    if (has("elliptical", "stair", "stepper")) return named("Stair climbing");
    if (has("jump rope", "skipping", "skip")) return named("Skipping");
    if (has("badminton")) return named("Badminton");
    if (has("tennis")) return named("Tennis");
    if (has("football", "soccer")) return named("Football");
    if (has("cricket")) return named("Cricket");
    if (has("dance")) return named("Dance");
    if (has("household", "chore")) return named("Household chores");
    if (has("garden")) return named("Gardening");
  }
  const cleaned = titleCase(h.replace(/[^\p{L}\p{N}\s/&-]+/gu, " ")).slice(
    0,
    60,
  );
  return {
    typeName: "Other",
    custom: cleaned && !/^\d+$/.test(cleaned) ? cleaned : "Workout",
  };
}

export function validateParsedWorkout(
  w: ParsedWorkout,
  now: Date = new Date(),
): string[] {
  const problems: string[] = [];
  const dur = w.movingSec ?? w.elapsedSec;
  const startMs = Date.parse(w.startTime);
  if (
    !Number.isFinite(dur) ||
    !Number.isFinite(w.elapsedSec) ||
    !Number.isFinite(startMs)
  ) {
    return ["The workout has missing or invalid time values."];
  }
  if (dur < 60) problems.push("The workout is shorter than 1 minute.");
  else if (dur > 600 * 60)
    problems.push("The workout is longer than 10 hours (600 minutes).");
  if (w.elapsedSec > 24 * 3600)
    problems.push("The workout spans more than 24 hours.");
  if (startMs > now.getTime() + 5 * 60_000)
    problems.push("The workout starts in the future.");
  if (w.distanceKm !== null && !Number.isFinite(w.distanceKm)) {
    problems.push("The distance is not a valid number.");
  }
  return problems;
}

export async function deterministicActivityId(
  userId: string,
  w: ParsedWorkout,
): Promise<string> {
  const input = `${userId}|${w.startTime}|${Math.round(w.elapsedSec)}|${w.distanceKm ?? ""}`;
  const subtle = (
    globalThis as unknown as {
      crypto: {
        subtle: { digest(a: string, d: Uint8Array): Promise<ArrayBuffer> };
      };
    }
  ).crypto.subtle;
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  let hex = "";
  for (const b of new Uint8Array(digest))
    hex += b.toString(16).padStart(2, "0");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-` +
    `${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

export interface ImportRowContext {
  userId: string;
  id: string;
  fileName: string;
  typeIdByName: Record<string, number>;
  metByTypeId: Record<
    number,
    { met_light: number; met_moderate: number; met_vigorous: number }
  >;
  weightKg: number | null;
  maxHr: number | null;
}

function hrOrNull(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const r = Math.round(v);
  return r >= MIN_HR && r <= MAX_HR ? r : null;
}

export function buildImportRow(
  w: ParsedWorkout,
  ctx: ImportRowContext,
): ImportActivityUpsert {
  const { typeName, custom } = mapFileSport(w.sportHint);
  const mappedId = ctx.typeIdByName[typeName];
  const typeId = mappedId ?? ctx.typeIdByName["Other"] ?? 18;
  const isOther = typeName === "Other" || mappedId === undefined;
  const durationMin = Math.min(
    600,
    Math.max(1, Math.round((w.movingSec ?? w.elapsedSec) / 60)),
  );
  const avgHr = hrOrNull(w.avgHr);
  const maxHr = hrOrNull(w.maxHr);
  const intensity = intensityFromHr(avgHr, ctx.maxHr);

  let calories: number | null;
  let estimated: boolean;
  if (w.calories !== null && Number.isFinite(w.calories) && w.calories > 0) {
    calories = Math.round(w.calories);
    estimated = false;
  } else {
    estimated = true;
    const met = ctx.metByTypeId[typeId];
    calories =
      met && ctx.weightKg !== null && ctx.weightKg > 0
        ? metKcal({
            met: metForIntensity(met, intensity),
            weightKg: ctx.weightKg,
            durationMin,
          })
        : null;
  }

  let notes = `Imported from ${ctx.fileName}`;
  if (w.name) notes += ` (${w.name})`;
  if (notes.length > 200) notes = notes.slice(0, 200);

  return {
    id: ctx.id,
    user_id: ctx.userId,
    source: "manual",
    activity_type_id: typeId,
    custom_name: isOther ? (custom ?? "Workout") : null,
    start_time: w.startTime,
    duration_min: durationMin,
    distance_km:
      w.distanceKm !== null && Number.isFinite(w.distanceKm)
        ? round3(w.distanceKm)
        : null,
    intensity,
    avg_hr: avgHr,
    max_hr: maxHr,
    calories,
    calories_estimated: estimated,
    notes,
  };
}

export function hrZoneSecondsForWorkout(
  w: ParsedWorkout,
  maxHr: number,
): [number, number, number, number, number] | null {
  if (!w.hr || w.hr.heartrate.length === 0) return null;
  return timeInHrZones(w.hr, maxHr);
}
