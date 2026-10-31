import type { PdfBlock, PdfChartId, PdfDocModel } from "@fittrack/shared";
import { chartFallbackDecision, fitImage, type ChartImage } from "./chartRaster";

/** A4 portrait, millimetres. */
export const PAGE = { w: 210, h: 297, margin: 14 } as const;
const CONTENT_W = PAGE.w - PAGE.margin * 2;
const FOOTER_RESERVE = 10;
const MAX_Y = PAGE.h - PAGE.margin - FOOTER_RESERVE;
const CHART_MAX_H = 80;

/** Helvetica in jsPDF only covers Latin-1; map common typography and drop the rest so nothing garbles. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[–—−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/≈/g, "~")
    .replace(/[\u00A0\u2009\u202F]/g, " ")
    .replace(/[^\n\x20-\xFF]/g, "?");
}

/** Group stats into rows of two for the two-column grid. */
export function pairUp<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

export function pageLabel(n: number, total: number): string {
  return `Page ${n} of ${total}`;
}

export type ChartProvider = (id: PdfChartId) => Promise<ChartImage | null>;

interface AutoTableDoc { lastAutoTable?: { finalY: number } }

export interface RenderedPdf { bytes: ArrayBuffer; pages: number }

/** Render the model to a PDF. jsPDF and autotable are imported here (dynamically) so they stay out of the main bundle. */
export async function renderPdf(model: PdfDocModel, getChart: ChartProvider = async () => null): Promise<RenderedPdf> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  doc.setProperties({ title: pdfSafe(model.title) });
  let y = PAGE.margin;

  const ensure = (h: number) => {
    if (y + h > MAX_Y) { doc.addPage(); y = PAGE.margin; }
  };
  const lines = (text: string, width: number): string[] => doc.splitTextToSize(pdfSafe(text), width) as string[];
  const ink = (r: number, g: number, b: number) => doc.setTextColor(r, g, b);
  const writeLines = (ls: string[], x: number, size: number, lh: number) => {
    for (const l of ls) { ensure(lh); doc.text(l, x, y + size * 0.3528); y += lh; }
  };

  for (const block of model.blocks) {
    switch (block.type) {
      case "title": {
        doc.setFont("helvetica", "bold"); doc.setFontSize(20); ink(17, 24, 39);
        writeLines(lines(block.text, CONTENT_W), PAGE.margin, 20, 9);
        y += 1;
        break;
      }
      case "subtitle": {
        doc.setFont("helvetica", "normal"); doc.setFontSize(10); ink(75, 85, 99);
        writeLines(lines(block.text, CONTENT_W), PAGE.margin, 10, 5);
        y += 2;
        break;
      }
      case "stats": {
        const colW = (CONTENT_W - 4) / 2;
        for (const row of pairUp(block.items)) {
          const cells = row.map((it) => ({
            label: lines(it.label, colW - 6),
            value: lines(it.value, colW - 6),
            note: it.note ? lines(it.note, colW - 6) : [],
          }));
          const h = Math.max(...cells.map((c) => 3.5 * c.label.length + 5.5 * c.value.length + 3.2 * c.note.length)) + 5;
          ensure(h + 2);
          cells.forEach((c, i) => {
            const x = PAGE.margin + i * (colW + 4);
            doc.setDrawColor(209, 213, 219); doc.roundedRect(x, y, colW, h, 1.5, 1.5, "S");
            let ty = y + 4;
            doc.setFont("helvetica", "normal"); doc.setFontSize(8); ink(107, 114, 128);
            for (const l of c.label) { doc.text(l, x + 3, ty); ty += 3.5; }
            doc.setFont("helvetica", "bold"); doc.setFontSize(12); ink(17, 24, 39);
            for (const l of c.value) { doc.text(l, x + 3, ty + 1); ty += 5.5; }
            doc.setFont("helvetica", "normal"); doc.setFontSize(7); ink(107, 114, 128);
            for (const l of c.note) { doc.text(l, x + 3, ty); ty += 3.2; }
          });
          y += h + 2;
        }
        y += 3;
        break;
      }
      case "table": {
        if (block.title) {
          doc.setFont("helvetica", "bold"); doc.setFontSize(12); ink(17, 24, 39);
          const tl = lines(block.title, CONTENT_W);
          ensure(tl.length * 6 + 20);
          writeLines(tl, PAGE.margin, 12, 6);
        }
        autoTable(doc, {
          startY: y,
          head: [block.head.map(pdfSafe)],
          body: block.rows.map((r) => r.map(pdfSafe)),
          margin: { left: PAGE.margin, right: PAGE.margin, top: PAGE.margin, bottom: PAGE.margin + FOOTER_RESERVE },
          theme: "grid",
          styles: { fontSize: 8, cellPadding: 1.6, overflow: "linebreak", textColor: [17, 24, 39], lineColor: [209, 213, 219], lineWidth: 0.1 },
          headStyles: { fillColor: [229, 231, 235], textColor: [17, 24, 39], fontStyle: "bold" },
          tableWidth: CONTENT_W,
        });
        const last = (doc as unknown as AutoTableDoc).lastAutoTable;
        y = (last?.finalY ?? y) + 6;
        break;
      }
      case "bullets": {
        doc.setFont("helvetica", "bold"); doc.setFontSize(12); ink(17, 24, 39);
        ensure(14);
        writeLines(lines(block.title, CONTENT_W), PAGE.margin, 12, 6);
        doc.setFont("helvetica", "normal"); doc.setFontSize(10);
        for (const item of block.items) {
          const ls = lines(item, CONTENT_W - 6);
          ensure(5);
          doc.text("-", PAGE.margin + 1, y + 3.5);
          writeLines(ls, PAGE.margin + 6, 10, 5);
          y += 0.8;
        }
        y += 3;
        break;
      }
      case "note": {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); ink(107, 114, 128);
        writeLines(lines(block.text, CONTENT_W), PAGE.margin, 8, 4);
        y += 2;
        break;
      }
      case "chart": {
        await drawChart(block, getChart);
        break;
      }
    }
  }

  async function drawChart(block: Extract<PdfBlock, { type: "chart" }>, provider: ChartProvider) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); ink(17, 24, 39);
    const tl = lines(block.title, CONTENT_W);
    ensure(tl.length * 6 + 12);
    writeLines(tl, PAGE.margin, 12, 6);
    let img: ChartImage | null = null;
    try { img = await provider(block.id); } catch { img = null; }
    if (chartFallbackDecision(img) === "image" && img) {
      const { w, h } = fitImage(img.width, img.height, CONTENT_W, CHART_MAX_H);
      try {
        ensure(h + 2);
        doc.addImage(img.dataUrl, "PNG", PAGE.margin, y, w, h);
        y += h + 4;
        return;
      } catch { /* fall through to the text description */ }
    }
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); ink(75, 85, 99);
    writeLines(lines(block.alt, CONTENT_W), PAGE.margin, 9, 4.5);
    y += 3;
  }

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); ink(107, 114, 128);
    doc.text("FitTrack - estimates, not medical advice", PAGE.margin, PAGE.h - PAGE.margin + 2);
    doc.text(pageLabel(p, total), PAGE.w - PAGE.margin, PAGE.h - PAGE.margin + 2, { align: "right" });
  }
  return { bytes: doc.output("arraybuffer"), pages: total };
}
