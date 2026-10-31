import { useEffect, useRef, useState } from "react";
import {
  buildDailyCsv, buildEntriesCsv, buildInsights, buildPdfModel, exportFileName, formatIstDateTime, formatRangeLabel,
  type DateRange, type ExportMeta, type ReportInputs, type RangeSummary,
} from "@fittrack/shared";
import { Banner, cardCls } from "../../profile/ui";
import { CSV_MIME, PDF_MIME, downloadBlob } from "./download";
import { KIND_LABEL, errorMessage, exportAvailability, successMessage, type ExportKind } from "./exportLogic";
import { rasterizeChart } from "./chartRaster";

interface Props {
  range: DateRange;
  summary: RangeSummary | null;
  inputs: ReportInputs | null;
  loading: boolean;
  empty: boolean;
  userName: string | null;
}

export function ExportMenu({ range, summary, inputs, loading, empty, userName }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const avail = exportAvailability({ loaded: summary != null && inputs != null, loading, empty, busy: busy != null });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const run = async (kind: ExportKind) => {
    if (!summary || !inputs) return;
    setOpen(false);
    setBusy(kind);
    setMsg(null);
    try {
      const meta: ExportMeta = { rangeLabel: formatRangeLabel(range), generatedAtIst: formatIstDateTime(new Date()), userName };
      let saved: string;
      if (kind === "daily" || kind === "entries") {
        const file = kind === "daily" ? buildDailyCsv(summary, meta) : buildEntriesCsv(inputs, meta);
        saved = downloadBlob(file.content, file.filename, CSV_MIME);
      } else {
        const model = buildPdfModel(summary, buildInsights(summary), meta);
        const { renderPdf } = await import("./renderPdf");
        const out = await renderPdf(model, (id) => rasterizeChart(id));
        saved = downloadBlob(out.bytes, exportFileName("pdf", range), PDF_MIME);
      }
      setMsg({ kind: "success", text: successMessage(saved) });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(kind, e) });
    } finally {
      setBusy(null);
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
