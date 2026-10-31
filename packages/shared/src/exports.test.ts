import { describe, expect, it } from "vitest";
import {
  buildDailyCsv,
  buildEntriesCsv,
  buildPdfModel,
  buildWeeklyEmail,
  csvEscape,
  exportFileName,
  formatIstDateTime,
  formatRangeLabel,
} from "./exports";
import { buildInsights, summarizeRange } from "./reports";
import type {
  ReportActivity,
  ReportInputs,
  ReportMeal,
  ReportProfile,
} from "./reportTypes";
import type { ExportMeta, WeeklyEmailMeta } from "./exportTypes";

const profile: ReportProfile = {
  sex: "female",
  dob: "1993-06-15",
  heightCm: 162,
  weightKg: 68,
  targetWeightKg: 60,
  goal: "lose",
  pace: 0.25,
  bmiStandard: "asian",
  dailyKcalTarget: 1500,
  proteinTargetG: 95,
  carbTargetG: 170,
  fatTargetG: 45,
  exerciseAddbackPct: 50,
};
const TODAY = "2026-03-10";

function meal(date: string, meal_type: ReportMeal["meal_type"], food_name: string, kcal: number): ReportMeal {
  return { date, meal_type, food_name, kcal, protein: 10, carbs: 20.5, fat: 5 };
}
function act(over: Partial<ReportActivity> & { id: string; start_time: string }): ReportActivity {
  return {
    activity_type_id: 1,
    custom_name: null,
    name: null,
    source: "manual",
    duration_min: 30,
    distance_km: null,
    avg_hr: null,
    max_hr: null,
    calories: null,
    calories_estimated: false,
    excluded: false,
    zones: null,
    ...over,
  };
}
function inputs(over: Partial<ReportInputs> = {}): ReportInputs {
  return {
    range: { from: "2026-03-04", to: TODAY },
    today: TODAY,
    profile,
    meals: [],
    activities: [],
    weights: [],
    typeNames: { 1: "Run", 2: "Walk" },
    ...over,
  };
}

const meta: ExportMeta = {
  rangeLabel: "4 Mar - 10 Mar 2026",
  generatedAtIst: "31 Oct 2026, 14:05 IST",
  userName: "Asha",
};
const emailMeta: WeeklyEmailMeta = {
  ...meta,
  appUrl: "https://app.example.com",
  unsubscribeUrl: "https://app.example.com/api/email/unsubscribe?token=u.abc",
};

const fixtureMeals = [
  meal("2026-03-06", "breakfast", "Oats", 300),
  meal("2026-03-06", "lunch", "Rice, \"brown\"", 600),
  meal("2026-03-08", "dinner", "=SUM(A1)", 900),
];
const fixtureActs = [
  act({ id: "a", start_time: "2026-03-08T00:30:00Z", avg_hr: 140, max_hr: 170, calories: 250, zones: { zone1_s: 60, zone2_s: 120, zone3_s: 180, zone4_s: 240, zone5_s: 300 } }),
  act({ id: "b", start_time: "2026-03-07T20:00:00Z", custom_name: "Padel", calories_estimated: true }),
  act({ id: "c", start_time: "2026-03-08T02:00:00Z", excluded: true }),
];
const full = (): ReportInputs => inputs({ meals: fixtureMeals, activities: fixtureActs });

const BAD = /NaN|undefined|Infinity|null/;

describe("csvEscape", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("a\nb")).toBe('"a\nb"');
    expect(csvEscape("plain")).toBe("plain");
  });
  it("guards formula characters in text", () => {
    for (const c of ["=", "+", "-", "@", "\t"]) expect(csvEscape(`${c}x`)).toBe(`'${c}x`);
    expect(csvEscape("\rx")).toBe('"\'\rx"');
    expect(csvEscape("=1,2")).toBe("\"'=1,2\"");
  });
  it("writes numbers as-is and treats numeric strings as text", () => {
    expect(csvEscape(-5)).toBe("-5");
    expect(csvEscape("-5")).toBe("'-5");
    expect(csvEscape(0)).toBe("0");
    expect(csvEscape(1.5)).toBe("1.5");
  });
  it("handles null, NaN and booleans", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
    expect(csvEscape(NaN)).toBe("");
    expect(csvEscape(Infinity)).toBe("");
    expect(csvEscape(true)).toBe("true");
    expect(csvEscape(false)).toBe("false");
  });
});

describe("labels and names", () => {
  it("formats ranges", () => {
    expect(formatRangeLabel({ from: "2026-03-05", to: "2026-03-05" })).toBe("5 Mar 2026");
    expect(formatRangeLabel({ from: "2026-03-05", to: "2026-03-11" })).toBe("5 Mar - 11 Mar 2026");
    expect(formatRangeLabel({ from: "2026-02-27", to: "2026-03-05" })).toBe("27 Feb - 5 Mar 2026");
    expect(formatRangeLabel({ from: "2025-12-28", to: "2026-01-03" })).toBe("28 Dec 2025 - 3 Jan 2026");
  });
  it("formats IST date times around midnight", () => {
    expect(formatIstDateTime(new Date("2026-10-31T08:35:00Z"))).toBe("31 Oct 2026, 14:05 IST");
    expect(formatIstDateTime(new Date("2026-10-31T18:29:00Z"))).toBe("31 Oct 2026, 23:59 IST");
    expect(formatIstDateTime(new Date("2026-10-31T18:30:00Z"))).toBe("1 Nov 2026, 00:00 IST");
    expect(formatIstDateTime(new Date("2025-12-31T18:30:00Z"))).toBe("1 Jan 2026, 00:00 IST");
  });
  it("builds file names", () => {
    const r = { from: "2026-03-05", to: "2026-03-11" };
    expect(exportFileName("daily", r)).toBe("fittrack-daily-2026-03-05_to_2026-03-11.csv");
    expect(exportFileName("entries", r)).toBe("fittrack-entries-2026-03-05_to_2026-03-11.csv");
    expect(exportFileName("pdf", r)).toBe("fittrack-report-2026-03-05_to_2026-03-11.pdf");
    expect(exportFileName("pdf", { from: "2026-03-05", to: "2026-03-05" })).toBe(
      "fittrack-report-2026-03-05_to_2026-03-05.pdf",
    );
  });
});

describe("buildDailyCsv", () => {
  const file = buildDailyCsv(summarizeRange(full()), meta);
  const lines = file.content.slice(1).split("\r\n");
  it("has BOM, CRLF, header and filename", () => {
    expect(file.content.charCodeAt(0)).toBe(0xfeff);
    expect(file.content.endsWith("\r\n")).toBe(true);
    expect(file.content.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(lines[0]).toBe(
      "date,logged,kcal_in,protein_g,carbs_g,fat_g,breakfast_kcal,lunch_kcal,snack_kcal,dinner_kcal,active_kcal,active_kcal_estimated,active_min,workouts,bmr_estimated,kcal_out_estimated,net_estimated,allowance,remaining,on_target",
    );
    expect(file.filename).toBe("fittrack-daily-2026-03-04_to_2026-03-10.csv");
    expect(lines.length).toBe(1 + 7 + 1);
  });
  it("leaves unlogged cells empty and fills logged days", () => {
    const unlogged = lines[1]!.split(",");
    expect(unlogged[0]).toBe("2026-03-04");
    expect(unlogged[1]).toBe("false");
    for (const i of [2, 3, 4, 5, 6, 7, 8, 9, 16, 18, 19]) expect(unlogged[i]).toBe("");
    const day = lines.find((l) => l.startsWith("2026-03-06"))!.split(",");
    expect(day[1]).toBe("true");
    expect(day[2]).toBe("900");
    expect(day[4]).toBe("41");
    expect(day[6]).toBe("300");
    expect(day[19]).toBe("true");
  });
});

describe("buildEntriesCsv", () => {
  const file = buildEntriesCsv(full(), meta);
  const lines = file.content.slice(1).split("\r\n").filter(Boolean);
  it("escapes names and guards formulas", () => {
    expect(file.content).toContain('"Rice, ""brown"""');
    expect(file.content).toContain("'=SUM(A1)");
    expect(file.content.charCodeAt(0)).toBe(0xfeff);
  });
  it("sorts by date then time, IST, and omits excluded", () => {
    expect(lines[0]!.startsWith("type,date,time,meal_type,name")).toBe(true);
    const body = lines.slice(1);
    expect(body.length).toBe(5);
    // 03-07T20:00Z = 03-08 01:30 IST; 03-08T00:30Z = 03-08 06:00 IST
    expect(body.map((l) => l.split(",").slice(0, 3).join(","))).toEqual([
      "meal,2026-03-06,",
      "meal,2026-03-06,",
      "meal,2026-03-08,",
      "activity,2026-03-08,01:30",
      "activity,2026-03-08,06:00",
    ]);
    expect(body[3]).toContain("Padel");
    expect(body[4]).toContain("Run");
    expect(file.content).not.toContain("07:30");
  });
});

describe("buildPdfModel", () => {
  it("has stats, tables and estimated notes, no bad strings", () => {
    const s = summarizeRange(full());
    const doc = buildPdfModel(s, buildInsights(s), meta);
    expect(doc.title).toBe("FitTrack report");
    expect(doc.fileName).toBe("fittrack-report-2026-03-04_to_2026-03-10.pdf");
    expect(doc.blocks[0]).toEqual({ type: "title", text: "FitTrack report" });
    const stats = doc.blocks.find((b) => b.type === "stats");
    expect(stats && stats.type === "stats" && stats.items.map((i) => i.label)).toContain("Days logged");
    const daily = doc.blocks.find((b) => b.type === "table" && b.title === "Daily");
    expect(daily && daily.type === "table" && daily.head).toEqual(["Date", "In", "Out (est.)", "Net (est.)", "Active min", "On target"]);
    expect(daily && daily.type === "table" && daily.rows[0]![1]).toBe("-");
    expect(JSON.stringify(doc)).toContain("7,700");
    const ids = doc.blocks.filter((b) => b.type === "chart").map((b) => (b as { id: string }).id);
    expect(ids).toEqual(expect.arrayContaining(["inOut", "net", "slots", "macros"]));
    expect(doc.blocks.at(-1)).toEqual({
      type: "note",
      text: "BMI and calorie figures are estimates and not medical advice. Calories out are estimated.",
    });
    expect(JSON.stringify(doc)).not.toMatch(BAD);
  });
  it("includes HR only with HR data", () => {
    const withHr = summarizeRange(full());
    expect(withHr.hr.hasData).toBe(true);
    const a = buildPdfModel(withHr, [], meta);
    expect(a.blocks.some((b) => b.type === "chart" && b.id === "hr")).toBe(true);
    expect(JSON.stringify(a)).toContain("Average heart rate");
    const noHr = summarizeRange(inputs({ meals: fixtureMeals }));
    expect(noHr.hr.hasData).toBe(false);
    const b = buildPdfModel(noHr, [], meta);
    expect(b.blocks.some((x) => x.type === "chart" && x.id === "hr")).toBe(false);
    expect(JSON.stringify(b).toLowerCase()).not.toContain("heart rate");
    expect(b.blocks.some((x) => x.type === "bullets")).toBe(false);
    expect(JSON.stringify(b)).not.toMatch(BAD);
  });
  it("handles an empty range", () => {
    const doc = buildPdfModel(summarizeRange(inputs()), [], meta);
    expect(doc.blocks.map((b) => b.type)).toEqual(["title", "subtitle", "note", "note"]);
    expect(JSON.stringify(doc)).toContain("Nothing was logged in this range.");
    expect(JSON.stringify(doc)).not.toMatch(BAD);
  });
  it("shows estimated average in alt text", () => {
    const s = summarizeRange(full());
    const doc = buildPdfModel(s, [], meta);
    const c = doc.blocks.find((b) => b.type === "chart" && b.id === "inOut");
    expect(c && c.type === "chart" && c.alt).toMatch(/^Average intake [\d,]+ kcal against about [\d,]+ kcal burned \(estimated\)\.$/);
  });
});

describe("buildWeeklyEmail", () => {
  const s = summarizeRange(full());
  it("builds subject, html and text", () => {
    const e = buildWeeklyEmail(s, ["one", "two", "three", "four", "five"], emailMeta);
    expect(e.subject).toBe("Your FitTrack week: 4 Mar - 10 Mar 2026");
    expect(e.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(e.html).toContain('<meta name="color-scheme" content="light dark">');
    expect(e.html).toContain("Hi Asha,");
    expect(e.html).toContain("2 of 7");
    expect(e.html).toContain("four");
    expect(e.html).not.toContain("five");
    expect(e.html).toContain('href="https://app.example.com"');
    expect(e.html).toContain("not medical advice");
    expect(e.text).toContain(emailMeta.unsubscribeUrl);
    expect(e.text).toContain(emailMeta.appUrl);
    expect(e.html + e.text).not.toMatch(BAD);
  });
  it("escapes dynamic text and rejects unsafe URLs", () => {
    const e = buildWeeklyEmail(s, ["<script>alert(2)</script>"], {
      ...emailMeta,
      userName: "<script>alert(1)</script>",
      appUrl: "javascript:alert(1)",
      unsubscribeUrl: 'https://x.example/u?a="b"&c=<d>',
    });
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(e.html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
    expect(e.html).toContain('href="#"');
    expect(e.html).not.toContain("javascript:");
    expect(e.html).toContain("a=&quot;b&quot;&amp;c=&lt;d&gt;");
  });
  it("uses a plain greeting without a name", () => {
    const e = buildWeeklyEmail(s, [], { ...emailMeta, userName: null });
    expect(e.text.startsWith("Hi,\n")).toBe(true);
    expect(e.html).toContain("Hi,");
  });
  it("is safe with zero logged days", () => {
    const e = buildWeeklyEmail(summarizeRange(inputs()), [], emailMeta);
    expect(e.html).toContain("You did not log meals this week");
    expect(e.text).toContain("You did not log meals this week");
    expect(e.text).toContain(emailMeta.unsubscribeUrl);
    expect(e.html + e.text).not.toMatch(BAD);
  });
});
