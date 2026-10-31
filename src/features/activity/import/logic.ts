import {
  ageFromDob, buildImportRow, findDuplicateCandidates, mapFileSport, parseActivityFile, validateParsedWorkout,
  type ActivitySource, type ImportActivityUpsert, type ParsedWorkout,
} from "@fittrack/shared";
import type { ActivityTypeRow } from "@/lib/database.types";

/** Pure logic for the activity file import sheet (no I/O, no React). */

export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const BATCH_SIZE = 20;

export interface FileLike { name: string; size: number }
export interface RejectedFile { name: string; reason: string }

/** Keep at most 20 files with a .gpx/.tcx name and a size within 10 MB; say why each other file was left out. */
export function validateFiles<T extends FileLike>(files: T[], existingCount = 0): { accepted: T[]; rejected: RejectedFile[] } {
  const accepted: T[] = [];
  const rejected: RejectedFile[] = [];
  for (const f of files) {
    if (!/\.(gpx|tcx)$/i.test(f.name)) rejected.push({ name: f.name, reason: "Only .gpx and .tcx files are supported." });
    else if (f.size <= 0) rejected.push({ name: f.name, reason: "The file is empty." });
    else if (f.size > MAX_FILE_BYTES) rejected.push({ name: f.name, reason: "The file is larger than 10 MB." });
    else if (existingCount + accepted.length >= MAX_FILES) rejected.push({ name: f.name, reason: `Only ${MAX_FILES} files can be imported at a time.` });
    else accepted.push(f);
  }
  return { accepted, rejected };
}

export interface FileText { name: string; text: string }
export interface ParsedItem { key: string; fileName: string; workout: ParsedWorkout }
export interface FileError { fileName: string; message: string }

/** Parse every file text. Re-run with another `assumeTz` to apply the IST switch without re-reading files. */
export function parseTexts(files: FileText[], assumeTz: "utc" | "ist"): { items: ParsedItem[]; errors: FileError[] } {
  const items: ParsedItem[] = [];
  const errors: FileError[] = [];
  for (const f of files) {
    const r = parseActivityFile(f.text, { fileName: f.name, assumeTz });
    if (!r.ok) { errors.push({ fileName: f.name, message: r.error }); continue; }
    r.workouts.forEach((workout, i) => items.push({ key: `${f.name}#${i}`, fileName: f.name, workout }));
  }
  return { items, errors };
}

export const needsTzChoice = (items: ParsedItem[]): boolean => items.some((i) => i.workout.timeWasAssumed);

/** UTC ISO window covering all start times +/- 1 day, or null with no items. */
export function existingWindow(items: ParsedItem[]): { fromIso: string; toIso: string } | null {
  const ts = items.map((i) => Date.parse(i.workout.startTime)).filter(Number.isFinite);
  if (ts.length === 0) return null;
  const DAY = 86_400_000;
  return { fromIso: new Date(Math.min(...ts) - DAY).toISOString(), toIso: new Date(Math.max(...ts) + DAY).toISOString() };
}

export type StatusKind = "ready" | "imported" | "similar" | "blocked";
export interface RowStatus { kind: StatusKind; label: string; selectable: boolean; defaultChecked: boolean }

export function decideStatus(a: { problems: string[]; idExists: boolean; similarCount: number }): RowStatus {
  if (a.problems.length > 0) return { kind: "blocked", label: `Can't import: ${a.problems[0]}`, selectable: false, defaultChecked: false };
  if (a.idExists) return { kind: "imported", label: "Already imported", selectable: false, defaultChecked: false };
  if (a.similarCount > 0) return { kind: "similar", label: "Looks like an activity you already logged", selectable: true, defaultChecked: false };
  return { kind: "ready", label: "Ready", selectable: true, defaultChecked: true };
}

export interface ExistingActivity { id: string; start_time: string; activity_type_id: number; source: ActivitySource }

export function similarCount(id: string, typeId: number, startTime: string, existing: ExistingActivity[]): number {
  return findDuplicateCandidates({ id, activity_type_id: typeId, start_time: startTime }, existing).length;
}

export interface TypeChoice { typeId: number; custom: string }

/** Default type for a workout from the file's sport text; "Other" carries a custom name. */
export function defaultTypeChoice(w: ParsedWorkout, types: ActivityTypeRow[]): TypeChoice | null {
  const { typeName, custom } = mapFileSport(w.sportHint);
  const t = types.find((x) => x.name === typeName) ?? types.find((x) => x.name === "Other");
  if (!t) return null;
  return { typeId: t.id, custom: t.name === "Other" ? (custom ?? "Workout") : "" };
}

export const isOtherType = (typeId: number, types: ActivityTypeRow[]): boolean => types.find((t) => t.id === typeId)?.name === "Other";

/** Problem with the user's own edits (not the file): "Other" needs a custom name. */
export function selectionProblem(choice: TypeChoice, types: ActivityTypeRow[]): string | null {
  return isOtherType(choice.typeId, types) && choice.custom.trim() === "" ? 'Enter a name for "Other".' : null;
}

export function typeMaps(types: ActivityTypeRow[]) {
  const typeIdByName: Record<string, number> = {};
  const metByTypeId: Record<number, { met_light: number; met_moderate: number; met_vigorous: number }> = {};
  for (const t of types) {
    typeIdByName[t.name] = t.id;
    metByTypeId[t.id] = { met_light: t.met_light, met_moderate: t.met_moderate, met_vigorous: t.met_vigorous };
  }
  return { typeIdByName, metByTypeId };
}

/** Profile max HR, else 220 minus age, else null. */
export function maxHrFor(profile: { max_hr: number | null; dob: string | null } | null, now: Date = new Date()): number | null {
  if (!profile) return null;
  if (profile.max_hr && profile.max_hr > 0) return profile.max_hr;
  if (profile.dob) {
    const age = ageFromDob(profile.dob, now);
    if (Number.isFinite(age) && age > 0 && age < 120) return 220 - age;
  }
  return null;
}

export interface RowInputs { userId: string; id: string; fileName: string; weightKg: number | null; maxHr: number | null; types: ActivityTypeRow[] }

/**
 * Build the activity row for a workout with the user's chosen type. The shared builder derives the type from the file's sport,
 * so the lookup for that mapped name is pointed at the chosen type id; the custom name is then set from the user's text.
 */
export function assembleRow(w: ParsedWorkout, choice: TypeChoice, inp: RowInputs): ImportActivityUpsert {
  const { typeIdByName, metByTypeId } = typeMaps(inp.types);
  const mapped = mapFileSport(w.sportHint).typeName;
  const row = buildImportRow(w, {
    userId: inp.userId, id: inp.id, fileName: inp.fileName, typeIdByName: { ...typeIdByName, [mapped]: choice.typeId },
    metByTypeId, weightKg: inp.weightKg, maxHr: inp.maxHr,
  });
  const other = isOtherType(choice.typeId, inp.types);
  return { ...row, activity_type_id: choice.typeId, custom_name: other ? (choice.custom.trim().slice(0, 80) || "Workout") : null };
}

export const chunk = <T,>(arr: T[], size = BATCH_SIZE): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export interface ImportOutcome { imported: number; skipped: number; failed: Array<{ label: string; reason: string }> }

export function summaryText(o: ImportOutcome): string {
  return `Imported ${o.imported}, skipped ${o.skipped} (already imported or not selected), failed ${o.failed.length}.`;
}

export function importButtonLabel(n: number): string {
  return n === 1 ? "Import 1 workout" : `Import ${n} workouts`;
}

/** Message shown after an import when the profile has no weight. */
export const NO_WEIGHT_NOTE =
  "Your profile has no weight, so calories were left empty where the file had none. Add your weight in Settings to get estimates.";

export const OFFLINE_MESSAGE = "Import needs a connection. Reconnect and try again.";

/** Short human duration like "1 h 05 min". */
export function formatMinutes(sec: number): string {
  const m = Math.max(1, Math.round(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
}

export { validateParsedWorkout };

export const SECURE_CONTEXT_MESSAGE = "Import needs a secure (https) connection";

/** True when the browser can hash (crypto.subtle is missing on plain http). */
export const canHash = (): boolean => typeof globalThis.crypto !== "undefined" && !!globalThis.crypto.subtle;

/** Compute ids one by one so a failing workout is left out without breaking the others. */
export async function computeIds(
  items: ParsedItem[], hash: (w: ParsedWorkout) => Promise<string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const i of items) {
    try { out[i.key] = await hash(i.workout); } catch { /* left out: shown as can't import */ }
  }
  return out;
}
