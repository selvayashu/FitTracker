export type ExportKind = "daily" | "entries" | "pdf";

export interface ExportAvailability { enabled: boolean; hint: string | null }

/** Whether the export menu can be used, and the hint to show when it cannot. */
export function exportAvailability(opts: { loaded: boolean; loading: boolean; empty: boolean; busy: boolean }): ExportAvailability {
  if (opts.loading) return { enabled: false, hint: "Export is available once the report has loaded." };
  if (!opts.loaded) return { enabled: false, hint: "Nothing to export yet." };
  if (opts.empty) return { enabled: false, hint: "Nothing to export: nothing is logged in this range." };
  if (opts.busy) return { enabled: false, hint: null };
  return { enabled: true, hint: null };
}

export const KIND_LABEL: Record<ExportKind, string> = { daily: "Daily CSV", entries: "Entries CSV", pdf: "PDF" };

export function successMessage(fileName: string): string {
  return `Saved ${fileName}`;
}

export function errorMessage(kind: ExportKind, err: unknown): string {
  const why = err instanceof Error && err.message ? ` (${err.message})` : "";
  return `Could not create the ${KIND_LABEL[kind]}${why}. Your data is unchanged; please try again.`;
}
