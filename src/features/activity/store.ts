import { useEffect, useState } from "react";
import { enqueue } from "@/lib/outbox";
import { supabase } from "@/lib/supabase";
import type { ActivityRow, ActivityTemplateRow, ActivityTypeRow } from "@/lib/database.types";
import type { ActivityWrite } from "./logic";

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
  await enqueue({ kind: "upsert", table: "activities", row: { ...w } });
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
  const localById = new Map(state.activities.map((a) => [a.id, a]));
  // While writes are queued, a local row is newer than the server copy of the same id.
  const server = ((data as ActivityRow[]) ?? []).filter((r) => !deleted.has(r.id))
    .map((r) => (pendingWrites ? localById.get(r.id) ?? r : r));
  const ids = new Set(server.map((r) => r.id));
  const localOnly = state.activities.filter((a) => !ids.has(a.id) && (pendingWrites || a.start_time < fromIso));
  state = { ...state, activities: sortDesc([...server, ...localOnly]) };
  persist(); emit();
}

export async function loadTemplates(userId: string): Promise<void> {
  const { data, error } = await supabase.from("activity_templates").select("*").eq("user_id", userId).order("created_at");
  if (error) throw new Error(error.message);
  state = { ...state, templates: (data as ActivityTemplateRow[]) ?? [] };
  persist(); emit();
}
