/** Export and email types. Part of the Phase 4 contract (frozen). */

export interface ExportMeta {
  /** e.g. "5 Mar - 11 Mar 2026" */
  rangeLabel: string;
  /** e.g. "31 Oct 2026, 14:05 IST" */
  generatedAtIst: string;
  userName: string | null;
}

export interface CsvFile {
  /** e.g. fittrack-daily-2026-03-05_to_2026-03-11.csv */
  filename: string;
  /** UTF-8 text starting with a BOM so Excel opens it correctly; CRLF line endings */
  content: string;
}

export type PdfChartId = "inOut" | "net" | "slots" | "macros" | "weight" | "hr";

export type PdfBlock =
  | { type: "title"; text: string }
  | { type: "subtitle"; text: string }
  | { type: "stats"; items: Array<{ label: string; value: string; note?: string }> }
  | { type: "table"; title?: string; head: string[]; rows: string[][] }
  | { type: "bullets"; title: string; items: string[] }
  | { type: "note"; text: string }
  /** The renderer substitutes a raster of the on-screen chart when it has one, else prints `alt` as text. */
  | { type: "chart"; id: PdfChartId; title: string; alt: string };

export interface PdfDocModel {
  fileName: string;
  title: string;
  blocks: PdfBlock[];
}

export interface WeeklyEmailMeta extends ExportMeta {
  /** absolute https URL of the app */
  appUrl: string;
  /** absolute one-click unsubscribe URL */
  unsubscribeUrl: string;
}

export interface EmailContent {
  subject: string;
  /** complete HTML document, inline styles only, all user text escaped */
  html: string;
  text: string;
}
