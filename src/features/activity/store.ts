import { useEffect, useState } from "react";
import { enqueue } from "@/lib/outbox";
import { supabase } from "@/lib/supabase";
import type { ActivityHrZoneRow, ActivityRow, ActivityTemplateRow, ActivityTypeRow } from "@/lib/database.types";
import {
  PHASE2_COLUMNS, isVisible, mergeActivities, normalizeNotes, overlayNotes, withoutPending, type ActivityWrite, type PendingNotes,
} from "./logic";

/**
 * Local optimistic state + localStorage cache shared by the page and the sheet.
 * All writes go through the outbox; this store only mirrors them locally.
 */
interface State { activities: ActivityRow[]; templates: ActivityTemplateRow[]; types: ActivityTypeRow[] }

let state: State = { activities: [], templates: [], types: [] };
let userKey: string | null = null;
const listeners = new Set<() => void>();

const read = <T,>(key: string, fallback: T): T => {
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
};
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota: ignore */ } };
const emit = () => listeners.forEach((l) => l());

function persist() {
  write("ft.activity.types", state.types);
  if (userKey) {
    write(`ft.activity.list.${userKey}`, state.activities);
    write(`ft.activity.templates.${userKey}`, state.templates);
  }
}

/** Load cached data for this user (call once the user id is known). */
export function hydrate(userId: string) {
  if (userKey === userId) return;
  userKey = userId;
  state = {
    types: read<ActivityTypeRow[]>("ft.activity.types", []),
    activities: read<ActivityRow[]>(`ft.activity.list.${userId}`, []),
    templates: read<ActivityTemplateRow[]>(`ft.activity.templates.${userId}`, []),
  };
  emit();
}

export function useActivityStore(): State {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return state;
}

const deleted = new Set<string>();
const sortDesc = (rows: ActivityRow[]) => [...rows].sort((a, b) => (a.start_time < b.start_time ? 1 : -1));

function toRow(w: ActivityWrite): ActivityRow {
  const now = new Date().toISOString();
  const prev = state.activities.find((a) => a.id === w.id);
  // Strava/duplicate columns are not part of a manual write: keep the existing values, else the DB defaults.
  const phase2 = { name: null, elevation_m: null, suffer_score: null, moving_time_s: null, elapsed_time_s: null, excluded: false, duplicate_dismissed: false };
  return { ...phase2, ...prev, ...w, created_at: prev?.created_at ?? now, updated_at: now };
}

export async function saveActivity(w: ActivityWrite) {
  deleted.delete(w.id);
  state = { ...state, activities: sortDesc([...state.activities.filter((a) => a.id !== w.id), toRow(w)]) };
  persist(); emit();
  // Strava-owned and review columns are never sent: an upsert only updates the columns it carries, so a notes edit
  // cannot overwrite excluded/duplicate_dismissed (or the Strava fields) with a stale local copy.
  const row: Record<string, unknown> & { id: string } = { ...w };
  for (const c of PHASE2_COLUMNS) delete row[c];
  if (w.source === "strava") delete row.duplicate_of;
  await enqueue({ kind: "upsert", table: "activities", row });
}

export async function deleteActivity(id: string) {
  deleted.add(id);
  state = { ...state, activities: state.activities.filter((a) => a.id !== id) };
  persist(); emit();
  await enqueue({ kind: "delete", table: "activities", id });
}

export async function saveTemplate(t: Omit<ActivityTemplateRow, "created_at">) {
  const row: ActivityTemplateRow = { ...t, created_at: new Date().toISOString() };
  state = { ...state, templates: [...state.templates.filter((x) => x.id !== t.id), row] };
  persist(); emit();
  await enqueue({ kind: "upsert", table: "activity_templates", row: { ...t } });
}

export async function deleteTemplate(id: string) {
  state = { ...state, templates: state.templates.filter((t) => t.id !== id) };
  persist(); emit();
  await enqueue({ kind: "delete", table: "activity_templates", id });
}

/** Fetch activity types (cached for offline). Falls back to the cache on failure. */
export async function loadTypes(): Promise<void> {
  const { data, error } = await supabase.from("activity_types").select("*").order("sort_order");
  if (error) throw new Error(error.message);
  state = { ...state, types: (data as ActivityTypeRow[]) ?? [] };
  persist(); emit();
}

/**
 * Fetch activities from `fromDate` (IST YYYY-MM-DD) and merge: server rows replace local rows in the window;
 * local rows missing on the server are kept (they are probably still queued in the outbox).
 */
export async function loadActivities(userId: string, fromIso: string, pendingWrites: boolean): Promise<void> {
  const { data, error } = await supabase.from("activities").select("*").eq("user_id", userId)
    .gte("start_time", fromIso).order("start_time", { ascending: false });
  if (error) throw new Error(error.message);
  const merged = mergeActivities(state.activities, (data as ActivityRow[]) ?? [], { fromIso, pendingWrites, deleted });
  state = { ...state, activities: overlayNotes(merged, readPending()) };
  persist(); emit();
  void flushPendingNotes();
}

const pendingKey = () => (userKey ? `ft.activity.pendingNotes.${userKey}` : null);
function readPending(): PendingNotes {
  const k = pendingKey();
  return k ? read<PendingNotes>(k, {}) : {};
}
function writePending(p: PendingNotes) {
  const k = pendingKey();
  if (k) write(k, p);
}

/**
 * Notes of a Strava row: the only editable field. Sends just `{ notes }` as an UPDATE of the existing row (never an insert,
 * so a row deleted server-side stays deleted). Offline or on failure the note is kept locally and re-applied later.
 */
export async function saveStravaNotes(id: string, text: string): Promise<void> {
  const notes = normalizeNotes(text);
  state = { ...state, activities: state.activities.map((a) => (a.id === id ? { ...a, notes } : a)) };
  persist(); emit();
  writePending({ ...readPending(), [id]: notes });
  await flushPendingNotes();
}

let flushing = false;
/** Apply queued notes edits as updates. Safe to call any time; does nothing offline. */
export async function flushPendingNotes(): Promise<void> {
  if (flushing || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  const pending = readPending();
  const ids = Object.keys(pending);
  if (ids.length === 0) return;
  flushing = true;
  try {
    const done: string[] = [];
    for (const id of ids) {
      const { error } = await supabase.from("activities").update({ notes: pending[id] }).eq("id", id);
      if (!error) done.push(id);
    }
    writePending(withoutPending(readPending(), done));
  } finally {
    flushing = false;
  }
}

if (typeof window !== "undefined") window.addEventListener("online", () => { void flushPendingNotes(); });

/** After the manual twin is deleted, the Strava row no longer points at it (the DB does the same via ON DELETE SET NULL). */
export function clearDuplicateLink(id: string) {
  state = { ...state, activities: state.activities.map((a) => (a.id === id ? { ...a, duplicate_of: null } : a)) };
  persist(); emit();
}

/** Drop every Strava row from the local cache (after "Disconnect and delete synced activities"). */
export function removeStravaLocal() {
  state = { ...state, activities: state.activities.filter((a) => a.source !== "strava") };
  persist(); emit();
}

/** HR zone rows for the given activities, keyed by activity id. One query. */
export async function loadHrZones(activityIds: string[]): Promise<Map<string, ActivityHrZoneRow>> {
  if (activityIds.length === 0) return new Map();
  const { data, error } = await supabase.from("activity_hr_zones").select("*").in("activity_id", activityIds);
  if (error) throw new Error(error.message);
  return new Map(((data as ActivityHrZoneRow[]) ?? []).map((z) => [z.activity_id, z]));
}

/** Fetch specific activities by id (the "other" row of a duplicate pair that is outside the loaded window). */
export async function fetchActivitiesById(ids: string[]): Promise<ActivityRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("activities").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return (data as ActivityRow[]) ?? [];
}

/** Direct (online-only) update of Strava-row review flags. Throws with a readable message on failure. */
export async function updateActivityFlags(id: string, patch: { excluded?: true; duplicate_dismissed?: true }): Promise<void> {
  const { error } = await supabase.from("activities").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  state = {
    ...state,
    activities: state.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)).filter(isVisible),
  };
  persist(); emit();
}

export async function loadTemplates(userId: string): Promise<void> {
  const { data, error } = await supabase.from("activity_templates").select("*").eq("user_id", userId).order("created_at");
  if (error) throw new Error(error.message);
  state = { ...state, templates: (data as ActivityTemplateRow[]) ?? [] };
  persist(); emit();
}
