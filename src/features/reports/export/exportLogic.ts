export type ExportKind = "daily" | "entries" | "pdf";

export interface ExportAvailability { enabled: boolean; hint: string | null }

export function sameRange(a: { from: string; to: string } | null | undefined, b: { from: string; to: string } | null | undefined): boolean {
  return a != null && b != null && a.from === b.from && a.to === b.to;
}

/**
 * Whether the export menu can be used, and the hint to show when it cannot.
 * `rangeMatches` is false for the one frame after the range changed but before the new data arrived.
 */
export function exportAvailability(opts: { loaded: boolean; loading: boolean; empty: boolean; busy: boolean; rangeMatches?: boolean }): ExportAvailability {
  if (opts.loading || opts.rangeMatches === false) return { enabled: false, hint: "Export is available once the report has loaded." };
  if (!opts.loaded) return { enabled: false, hint: "Nothing to export yet." };
  if (opts.empty) return { enabled: false, hint: "Nothing to export: nothing is logged in this range." };
  if (opts.busy) return { enabled: false, hint: null };
  return { enabled: true, hint: null };
}

export const KIND_LABEL: Record<ExportKind, string> = { daily: "Daily CSV", entries: "Entries CSV", pdf: "PDF" };

export const LOSSY_HINT = "Some characters could not be shown in the PDF; they are preserved in the CSV export.";

export function successMessage(fileName: string, lossy = false): string {
  return lossy ? `Saved ${fileName}. ${LOSSY_HINT}` : `Saved ${fileName}`;
}

export function errorMessage(kind: ExportKind, err: unknown): string {
  const why = err instanceof Error && err.message ? ` (${err.message})` : "";
  return `Could not create the ${KIND_LABEL[kind]}${why}. Your data is unchanged; please try again.`;
}
