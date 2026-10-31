/** Phase 4 export and email builders. Pure functions: no DOM, no Intl, UTC+05:30 arithmetic on instants. */
import type {
  CsvFile,
  EmailContent,
  ExportMeta,
  PdfBlock,
  PdfDocModel,
  WeeklyEmailMeta,
} from "./exportTypes";
import type { DateRange, RangeSummary, ReportInputs } from "./reportTypes";
import type { MealType } from "./types";
import { istDateOfIso } from "./reports";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SLOTS: MealType[] = ["breakfast", "lunch", "snack", "dinner"];
const SLOT_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Snack",
  dinner: "Dinner",
};
const BOM = "﻿";
const DISCLAIMER = "BMI and calorie figures are estimates and not medical advice.";
const CLOSING_NOTE = `${DISCLAIMER} Calories out are estimated.`;

// ---------------------------------------------------------------- csv

type Cell = string | number | boolean | null | undefined;

export function csvEscape(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let s = value;
  if (s.length > 0 && "=+-@\t\r".includes(s[0] as string)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells: Cell[]): string {
  return cells.map(csvEscape).join(",");
}

function csvFile(filename: string, head: string[], rows: string[]): CsvFile {
  return { filename, content: BOM + [head.join(","), ...rows].map((r) => `${r}\r\n`).join("") };
}

// ---------------------------------------------------------------- dates

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

function dm(date: string): string {
  const p = parts(date);
  return `${p.d} ${MONTHS[p.m - 1] ?? "???"}`;
}

export function formatRangeLabel(range: DateRange): string {
  const a = parts(range.from);
  const b = parts(range.to);
  if (range.from === range.to) return `${dm(range.to)} ${b.y}`;
  if (a.y === b.y) return `${dm(range.from)} - ${dm(range.to)} ${b.y}`;
  return `${dm(range.from)} ${a.y} - ${dm(range.to)} ${b.y}`;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

export function formatIstDateTime(date: Date): string {
  const t = new Date(date.getTime() + 5.5 * 3_600_000);
  if (Number.isNaN(t.getTime())) return "unknown time";
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}, ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())} IST`;
}

export function exportFileName(kind: "daily" | "entries" | "pdf", range: DateRange): string {
  const span = `${range.from}_to_${range.to}`;
  return kind === "pdf" ? `fittrack-report-${span}.pdf` : `fittrack-${kind}-${span}.csv`;
}

// ---------------------------------------------------------------- number formatting

function num(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function int(n: number): string {
  const r = Math.round(num(n));
  return (r < 0 ? "-" : "") + group(String(Math.abs(r)));
}

function dec(n: number, d: number): string {
  const v = num(n);
  const s = Math.abs(v).toFixed(d);
  const [i, f] = s.split(".") as [string, string | undefined];
  return (v < 0 && Number(s) !== 0 ? "-" : "") + group(i) + (f ? `.${f}` : "");
}

function signedInt(n: number): string {
  const r = Math.round(num(n));
  return (r > 0 ? "+" : "") + int(r);
}

function minutes(n: number): string {
  const m = Math.round(num(n));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function weightChangeText(kg: number): string {
  const v = num(kg);
  if (Math.abs(v) < 0.005) return "about 0.00 kg";
  return `${v < 0 ? "loss" : "gain"} of about ${dec(Math.abs(v), 2)} kg`;
}

// ---------------------------------------------------------------- daily csv

export function buildDailyCsv(summary: RangeSummary, _meta: ExportMeta): CsvFile {
  void _meta;
  const head = [
    "date", "logged", "kcal_in", "protein_g", "carbs_g", "fat_g",
    "breakfast_kcal", "lunch_kcal", "snack_kcal", "dinner_kcal",
    "active_kcal", "active_kcal_estimated", "active_min", "workouts",
    "bmr_estimated", "kcal_out_estimated", "net_estimated",
    "allowance", "remaining", "on_target",
  ];
  const rows = summary.days.map((d) => {
    const L = d.logged;
    return csvRow([
      d.date,
      L,
      L ? Math.round(d.kcalIn) : null,
      L ? d.proteinG : null,
      L ? d.carbsG : null,
      L ? d.fatG : null,
      ...SLOTS.map((s) => (L ? Math.round(d.bySlot[s]) : null)),
      Math.round(d.activeKcal),
      Math.round(d.activeKcalEstimated),
      Math.round(d.activeMin),
      d.workouts,
      Math.round(d.bmr),
      Math.round(d.kcalOut),
      L ? Math.round(d.net) : null,
      Math.round(d.allowance),
      L ? Math.round(d.remaining) : null,
      L ? d.onTarget : null,
    ]);
  });
  return csvFile(exportFileName("daily", summary.range), head, rows);
}

// ---------------------------------------------------------------- entries csv

function istTime(iso: string): string {
  const t = new Date(Date.parse(iso) + 5.5 * 3_600_000);
  return `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

export function buildEntriesCsv(inputs: ReportInputs, _meta: ExportMeta): CsvFile {
  void _meta;
  const head = [
    "type", "date", "time", "meal_type", "name", "kcal", "protein_g", "carbs_g", "fat_g",
    "source", "duration_min", "distance_km", "avg_hr", "max_hr", "calories_estimated",
  ];
  type Item = { date: string; time: string; cells: Cell[] };
  const items: Item[] = [];
  for (const m of inputs.meals) {
    items.push({
      date: m.date,
      time: "",
      cells: ["meal", m.date, "", m.meal_type, m.food_name, m.kcal, m.protein, m.carbs, m.fat, null, null, null, null, null, null],
    });
  }
  for (const a of inputs.activities) {
    if (a.excluded) continue;
    const date = istDateOfIso(a.start_time);
    const time = istTime(a.start_time);
    const name = a.custom_name || a.name || inputs.typeNames[a.activity_type_id] || "Activity";
    items.push({
      date,
      time,
      cells: ["activity", date, time, null, name, a.calories, null, null, null, a.source, a.duration_min, a.distance_km, a.avg_hr, a.max_hr, a.calories_estimated],
    });
  }
  const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  const rows = items
    .map((it, i) => ({ it, i }))
    .sort((x, y) => cmp(x.it.date, y.it.date) || cmp(x.it.time, y.it.time) || x.i - y.i)
    .map((x) => csvRow(x.it.cells));
  return csvFile(exportFileName("entries", inputs.range), head, rows);
}

// ---------------------------------------------------------------- pdf model

export function buildPdfModel(summary: RangeSummary, insights: string[], meta: ExportMeta): PdfDocModel {
  const s = summary;
  const blocks: PdfBlock[] = [];
  blocks.push({ type: "title", text: "FitTrack report" });
  const who = meta.userName ? `${meta.userName} - ` : "";
  blocks.push({ type: "subtitle", text: `${who}${meta.rangeLabel} - generated ${meta.generatedAtIst}` });
  const fileName = exportFileName("pdf", s.range);

  if (s.loggedDays === 0 && s.activity.workouts === 0) {
    blocks.push({ type: "note", text: "Nothing was logged in this range." });
    blocks.push({ type: "note", text: CLOSING_NOTE });
    return { fileName, title: "FitTrack report", blocks };
  }

  const logged = s.loggedDays > 0;
  blocks.push({
    type: "stats",
    items: [
      { label: "Days logged", value: `${s.loggedDays} of ${s.totalDays}` },
      { label: "Average in", value: logged ? `${int(s.avgKcalIn)} kcal` : "-" },
      { label: "Average out", value: logged ? `${int(s.avgKcalOut)} kcal` : "-", note: "estimated" },
      { label: "Average net", value: logged ? `${signedInt(s.avgNet)} kcal` : "-", note: "estimated" },
      { label: "Days on target", value: logged ? `${s.onTargetDays} of ${s.loggedDays}` : "-" },
      { label: "Active time", value: minutes(s.activity.totalMinutes) },
    ],
  });
  if (logged) {
    blocks.push({
      type: "note",
      text: `Estimated weight change: ${weightChangeText(s.estimatedWeightChangeKg)}. This is calculated from logged days only at about 7,700 kcal per kg; real change varies.`,
    });
  }

  blocks.push({
    type: "table",
    title: "Daily",
    head: ["Date", "In", "Out (est.)", "Net (est.)", "Active min", "On target"],
    rows: s.days.map((d) => [
      d.date,
      d.logged ? int(d.kcalIn) : "-",
      int(d.kcalOut),
      d.logged ? signedInt(d.net) : "-",
      int(d.activeMin),
      d.logged ? (d.onTarget ? "Yes" : "No") : "not logged",
    ]),
  });

  if (logged) {
    const m = s.macros;
    blocks.push({
      type: "table",
      title: "Macros (daily average vs target)",
      head: ["Macro", "Average", "Target", "% of target"],
      rows: [
        ["Protein", `${dec(m.avgProteinG, 1)} g`, `${int(m.targets.proteinG)} g`, `${int(m.pctOfTarget.protein)}%`],
        ["Carbs", `${dec(m.avgCarbsG, 1)} g`, `${int(m.targets.carbsG)} g`, `${int(m.pctOfTarget.carbs)}%`],
        ["Fat", `${dec(m.avgFatG, 1)} g`, `${int(m.targets.fatG)} g`, `${int(m.pctOfTarget.fat)}%`],
      ],
    });
    blocks.push({
      type: "table",
      title: "Meal slots",
      head: ["Slot", "Average kcal", "Share"],
      rows: s.slots.map((x) => [SLOT_LABEL[x.slot], int(x.avgKcal), `${int(x.pct)}%`]),
    });
  }

  if (s.activity.byType.length > 0) {
    blocks.push({
      type: "table",
      title: "Activity by type",
      head: ["Type", "Sessions", "Minutes", "Calories (est.)"],
      rows: s.activity.byType.map((t) => [t.name, int(t.count), int(t.minutes), int(t.kcal)]),
    });
  }

  if (s.topFoods.length > 0) {
    blocks.push({
      type: "table",
      title: "Top foods",
      head: ["Food", "Entries", "kcal"],
      rows: s.topFoods.map((f) => [f.name, int(f.count), int(f.kcal)]),
    });
  }

  if (s.hr.hasData) {
    blocks.push({
      type: "stats",
      items: [
        { label: "Average heart rate", value: s.hr.overallAvg === null ? "-" : `${int(s.hr.overallAvg)} bpm` },
        { label: "Max heart rate", value: s.hr.overallMax === null ? "-" : `${int(s.hr.overallMax)} bpm` },
      ],
    });
    blocks.push({
      type: "table",
      title: "Minutes per heart rate zone",
      head: ["Zone", "Minutes"],
      rows: s.hr.zoneSeconds.map((sec, i) => [`Zone ${i + 1}`, int(sec / 60)]),
    });
  }

  const w = s.weight;
  if (w.latestKg !== null) {
    const items: Array<{ label: string; value: string; note?: string }> = [
      { label: "Latest weight", value: `${dec(w.latestKg, 1)} kg` },
    ];
    if (w.startKg !== null) items.push({ label: "Start of range", value: `${dec(w.startKg, 1)} kg` });
    if (w.changeKg !== null) {
      items.push({ label: "Change in range", value: `${w.changeKg > 0 ? "+" : ""}${dec(w.changeKg, 1)} kg` });
    }
    if (w.progressPct !== null) items.push({ label: "Progress to target", value: `${int(w.progressPct)}%` });
    blocks.push({ type: "stats", items });
  }

  if (insights.length > 0) blocks.push({ type: "bullets", title: "Insights", items: insights });

  if (logged) {
    blocks.push({
      type: "chart",
      id: "inOut",
      title: "Calories in and out (estimated)",
      alt: `Average intake ${int(s.avgKcalIn)} kcal against about ${int(s.avgKcalOut)} kcal burned (estimated).`,
    });
    blocks.push({
      type: "chart",
      id: "net",
      title: "Net calories (estimated)",
      alt: `Average net ${signedInt(s.avgNet)} kcal per logged day (estimated), ${s.onTargetDays} of ${s.loggedDays} logged days on target.`,
    });
    const top = [...s.slots].sort((a, b) => b.pct - a.pct)[0];
    blocks.push({
      type: "chart",
      id: "slots",
      title: "Meal slots",
      alt: top ? `${SLOT_LABEL[top.slot]} was the largest share of intake at ${int(top.pct)}%.` : "Intake by meal slot.",
    });
    blocks.push({
      type: "chart",
      id: "macros",
      title: "Macros",
      alt: `Protein averaged ${int(s.macros.pctOfTarget.protein)}%, carbs ${int(s.macros.pctOfTarget.carbs)}% and fat ${int(s.macros.pctOfTarget.fat)}% of target.`,
    });
  }
  if (w.series.length > 0) {
    blocks.push({
      type: "chart",
      id: "weight",
      title: "Weight",
      alt:
        w.changeKg !== null && w.startKg !== null && w.latestKg !== null
          ? `Weight went from ${dec(w.startKg, 1)} kg to ${dec(w.latestKg, 1)} kg (${w.changeKg > 0 ? "+" : ""}${dec(w.changeKg, 1)} kg).`
          : `${w.series.length} weight ${w.series.length === 1 ? "entry" : "entries"} in this range.`,
    });
  }
  if (s.hr.hasData) {
    blocks.push({
      type: "chart",
      id: "hr",
      title: "Heart rate",
      alt: `Average heart rate ${s.hr.overallAvg === null ? "-" : int(s.hr.overallAvg)} bpm, maximum ${s.hr.overallMax === null ? "-" : int(s.hr.overallMax)} bpm.`,
    });
  }

  blocks.push({ type: "note", text: CLOSING_NOTE });
  return { fileName, title: "FitTrack report", blocks };
}

// ---------------------------------------------------------------- weekly email

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(u: string): string {
  return /^https?:\/\//i.test(u.trim()) ? u.trim() : "#";
}

export function buildWeeklyEmail(
  summary: RangeSummary,
  insights: string[],
  meta: WeeklyEmailMeta,
): EmailContent {
  const s = summary;
  const subject = `Your FitTrack week: ${meta.rangeLabel}`;
  const greeting = meta.userName && meta.userName.trim() ? `Hi ${meta.userName.trim()},` : "Hi,";
  const app = safeUrl(meta.appUrl);
  const unsub = safeUrl(meta.unsubscribeUrl);
  const picked = insights.slice(0, 4);
  const hasLogs = s.loggedDays > 0;

  const rows: Array<[string, string]> = hasLogs
    ? [
        ["Days logged", `${s.loggedDays} of ${s.totalDays}`],
        ["Average in", `${int(s.avgKcalIn)} kcal`],
        ["Average out (estimated)", `${int(s.avgKcalOut)} kcal`],
        ["Average net (estimated)", `${signedInt(s.avgNet)} kcal`],
        ["Days on target", `${s.onTargetDays} of ${s.loggedDays}`],
        ["Active time", minutes(s.activity.totalMinutes)],
        ["Estimated weight change", weightChangeText(s.estimatedWeightChangeKg)],
      ]
    : [["Active time", minutes(s.activity.totalMinutes)]];

  const FONT = "font-family:Arial,Helvetica,sans-serif;";
  const tr = rows
    .map(
      ([k, v]) =>
        `<tr><td style="${FONT}padding:8px 0;font-size:14px;color:#4b5563;background-color:#ffffff;border-bottom:1px solid #e5e7eb;">${esc(k)}</td><td align="right" style="${FONT}padding:8px 0;font-size:14px;font-weight:bold;color:#111827;background-color:#ffffff;border-bottom:1px solid #e5e7eb;">${esc(v)}</td></tr>`,
    )
    .join("");
  const lead = hasLogs ? "Here is how your last week went." : "You did not log meals this week.";
  const bullets = picked
    .map(
      (i) =>
        `<li style="${FONT}font-size:14px;line-height:20px;color:#111827;margin:0 0 6px 0;">${esc(i)}</li>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#e5e7eb;color:#111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e5e7eb;">
<tr><td align="center" style="padding:24px 12px;background-color:#e5e7eb;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border-radius:8px;">
<tr><td style="padding:24px;background-color:#ffffff;color:#111827;">
<h1 style="${FONT}font-size:20px;margin:0 0 4px 0;color:#111827;">Your FitTrack week</h1>
<p style="${FONT}font-size:13px;margin:0 0 16px 0;color:#4b5563;">${esc(meta.rangeLabel)}</p>
<p style="${FONT}font-size:15px;margin:0 0 4px 0;color:#111827;">${esc(greeting)}</p>
<p style="${FONT}font-size:15px;margin:0 0 16px 0;color:#111827;">${esc(lead)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">${tr}</table>
${picked.length > 0 ? `<h2 style="${FONT}font-size:16px;margin:20px 0 8px 0;color:#111827;">Highlights</h2>\n<ul style="margin:0;padding:0 0 0 20px;">${bullets}</ul>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;"><tr><td align="center" bgcolor="#0f766e" style="background-color:#0f766e;border-radius:6px;"><a href="${esc(app)}" style="${FONT}display:inline-block;padding:12px 24px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Open FitTrack</a></td></tr></table>
<p style="${FONT}font-size:12px;line-height:18px;margin:20px 0 0 0;color:#4b5563;">${esc(DISCLAIMER)} Calories out are estimated.</p>
<p style="${FONT}font-size:12px;line-height:18px;margin:8px 0 0 0;color:#4b5563;">You get this because weekly summaries are switched on. <a href="${esc(unsub)}" style="color:#0f766e;text-decoration:underline;">Unsubscribe</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    greeting,
    "",
    `Your FitTrack week: ${meta.rangeLabel}`,
    lead,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(picked.length > 0 ? ["", "Highlights:", ...picked.map((i) => `- ${i}`)] : []),
    "",
    `Open FitTrack: ${meta.appUrl}`,
    "",
    `${DISCLAIMER} Calories out are estimated.`,
    `Unsubscribe: ${meta.unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}
