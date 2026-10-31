import type { ImportActivityUpsert } from "@fittrack/shared";
import { supabase } from "@/lib/supabase";
import type { ActivityTypeRow } from "@/lib/database.types";
import { chunk, type ExistingActivity, type ImportOutcome } from "./logic";

/** Supabase I/O for the import sheet. Direct calls (the HR zone table is not in the offline outbox). */

export async function fetchTypes(): Promise<ActivityTypeRow[]> {
  const { data, error } = await supabase.from("activity_types").select("*").order("sort_order");
  if (error) throw new Error(error.message);
  return (data as ActivityTypeRow[]) ?? [];
}

/** The user's non-excluded activities in a time window, for duplicate detection. */
export async function fetchExisting(userId: string, fromIso: string, toIso: string): Promise<ExistingActivity[]> {
  const { data, error } = await supabase.from("activities").select("id,start_time,activity_type_id,source,excluded")
    .eq("user_id", userId).gte("start_time", fromIso).lte("start_time", toIso);
  if (error) throw new Error(error.message);
  return ((data as Array<ExistingActivity & { excluded: boolean }> | null) ?? []).filter((r) => !r.excluded);
}

/** Which of these ids already exist as activities. */
export async function fetchExistingIds(ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunk(ids, 100)) {
    const { data, error } = await supabase.from("activities").select("id").in("id", part);
    if (error) throw new Error(error.message);
    for (const r of (data as Array<{ id: string }> | null) ?? []) found.add(r.id);
  }
  return found;
}

export interface ImportEntry {
  label: string;
  row: ImportActivityUpsert;
  zones: [number, number, number, number, number] | null;
  maxHrUsed: number | null;
}

const upsertActivities = (rows: ImportActivityUpsert[]) => supabase.from("activities").upsert(rows, { onConflict: "id", ignoreDuplicates: true });

/** Insert in batches of 20; if a batch fails, retry its rows one by one so one bad row does not hide the others. */
export async function runImport(entries: ImportEntry[]): Promise<{ outcome: Omit<ImportOutcome, "skipped">; zoneFailures: string[] }> {
  const failed: ImportOutcome["failed"] = [];
  const stored: ImportEntry[] = [];
  for (const batch of chunk(entries)) {
    const { error } = await upsertActivities(batch.map((e) => e.row));
    if (!error) { stored.push(...batch); continue; }
    for (const e of batch) {
      const r = await upsertActivities([e.row]);
      if (r.error) failed.push({ label: e.label, reason: r.error.message }); else stored.push(e);
    }
  }
  const zoneFailures: string[] = [];
  for (const e of stored) {
    if (!e.zones || e.maxHrUsed === null) continue;
    const [z1, z2, z3, z4, z5] = e.zones;
    const { error } = await supabase.from("activity_hr_zones").upsert(
      { activity_id: e.row.id, user_id: e.row.user_id, zone1_s: z1, zone2_s: z2, zone3_s: z3, zone4_s: z4, zone5_s: z5, max_hr_used: e.maxHrUsed },
      { onConflict: "activity_id", ignoreDuplicates: true },
    );
    if (error) zoneFailures.push(`${e.label}: heart-rate zones not saved (${error.message})`);
  }
  return { outcome: { imported: stored.length, failed }, zoneFailures };
}
