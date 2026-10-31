import { useEffect, useRef, useState } from "react";
import {
  buildDailyCsv, buildEntriesCsv, buildInsights, buildPdfModel, exportFileName, formatIstDateTime, formatRangeLabel,
  type DateRange, type ExportMeta, type PdfChartId, type ReportInputs, type RangeSummary,
} from "@fittrack/shared";
import { Banner, cardCls } from "../../profile/ui";
import { CSV_MIME, PDF_MIME, downloadBlob } from "./download";
import { KIND_LABEL, errorMessage, exportAvailability, sameRange, successMessage, type ExportKind } from "./exportLogic";
import { rasterizeSnapshot, snapshotChart, type ChartSnapshot } from "./chartRaster";

interface Props {
  /** The range currently selected on screen. */
  range: DateRange;
  summary: RangeSummary | null;
  inputs: ReportInputs | null;
  loading: boolean;
  empty: boolean;
  userName: string | null;
  onBusyChange?: (busy: boolean) => void;
}

const nextFrame = () => new Promise<void>((r) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(r, 0));
  else setTimeout(r, 0);
});

export function ExportMenu({ range, summary, inputs, loading, empty, userName, onBusyChange }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const avail = exportAvailability({
    loaded: summary != null && inputs != null, loading, empty, busy: busy != null, rangeMatches: sameRange(inputs?.range, range),
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const run = async (kind: ExportKind) => {
    if (!summary || !inputs || !avail.enabled) return;
    // Capture everything from the SAME data the summary was built from, before anything yields.
    const exportRange = inputs.range;
    const meta: ExportMeta = { rangeLabel: formatRangeLabel(exportRange), generatedAtIst: formatIstDateTime(new Date()), userName };
    const model = kind === "pdf" ? buildPdfModel(summary, buildInsights(summary), meta) : null;
    const snaps = new Map<PdfChartId, ChartSnapshot | null>();
    if (model) for (const b of model.blocks) if (b.type === "chart") snaps.set(b.id, snapshotChart(b.id));

    setOpen(false);
    setBusy(kind);
    onBusyChange?.(true);
    setMsg(null);
    try {
      await nextFrame(); // let "Preparing..." paint before the heavy synchronous work
      let saved: string;
      let lossy = false;
      if (kind === "daily" || kind === "entries") {
        const file = kind === "daily" ? buildDailyCsv(summary, meta) : buildEntriesCsv(inputs, meta);
        saved = downloadBlob(file.content, file.filename, CSV_MIME);
      } else if (model) {
        const { renderPdf } = await import("./renderPdf");
        const out = await renderPdf(model, (id) => rasterizeSnapshot(snaps.get(id) ?? null));
        lossy = out.lossy;
        saved = downloadBlob(out.bytes, exportFileName("pdf", exportRange), PDF_MIME);
      } else {
        return;
      }
      setMsg({ kind: "success", text: successMessage(saved, lossy) });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(kind, e) });
    } finally {
      setBusy(null);
      onBusyChange?.(false);
    }
  };

  const itemCls = "block w-full px-3 py-2.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700";
  return (
    <section className={`${cardCls} space-y-2`} aria-label="Export">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Export</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Save this range as CSV or PDF.</p>
        </div>
        <div ref={wrapRef} className="relative shrink-0">
          <button type="button" aria-haspopup="menu" aria-expanded={open} disabled={!avail.enabled} onClick={() => setOpen((o) => !o)}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? "Preparing..." : "Export"}
          </button>
          {open && (
            <div role="menu" aria-label="Export format" className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
              {(["daily", "entries", "pdf"] as const).map((k) => (
                <button key={k} type="button" role="menuitem" className={itemCls} onClick={() => void run(k)}>{KIND_LABEL[k]}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      {avail.hint && <p className="text-xs text-slate-500 dark:text-slate-400">{avail.hint}</p>}
      {busy && <p role="status" className="text-xs text-slate-500 dark:text-slate-400">Preparing your {KIND_LABEL[busy]}...</p>}
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
    </section>
  );
}
