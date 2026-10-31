import type { ActivityRow } from "@/lib/database.types";

/** A Strava row needs review when it points at another row and the user has not dismissed it or hidden it. */
export const needsReview = (r: ActivityRow): boolean =>
  r.source === "strava" && r.duplicate_of !== null && !r.duplicate_dismissed && !r.excluded;

/** The row a Strava row duplicates, or null when it is not among `rows`. */
export function findOther(r: ActivityRow, rows: readonly ActivityRow[]): ActivityRow | null {
  if (r.duplicate_of === null) return null;
  return rows.find((x) => x.id === r.duplicate_of) ?? null;
}

/** Ids that must be fetched because a row under review points at them and they are not loaded. */
export function missingOtherIds(rows: readonly ActivityRow[]): string[] {
  const have = new Set(rows.map((r) => r.id));
  const out = new Set<string>();
  for (const r of rows) if (needsReview(r) && r.duplicate_of && !have.has(r.duplicate_of)) out.add(r.duplicate_of);
  return [...out];
}

export type DuplicateAction = "keep_strava" | "keep_manual" | "not_duplicate";

/** What each action does, as data: which row is deleted (via outbox) or which columns are updated on the Strava row. */
export function planDuplicateAction(
  action: DuplicateAction, strava: ActivityRow,
): { deleteId: string | null; update: { id: string; patch: { excluded?: true; duplicate_dismissed?: true } } | null } {
  switch (action) {
    case "keep_strava": return { deleteId: strava.duplicate_of, update: null };
    case "keep_manual": return { deleteId: null, update: { id: strava.id, patch: { excluded: true } } };
    case "not_duplicate": return { deleteId: null, update: { id: strava.id, patch: { duplicate_dismissed: true } } };
  }
}
