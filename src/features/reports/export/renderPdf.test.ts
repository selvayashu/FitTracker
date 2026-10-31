import { describe, expect, it } from "vitest";
import type { PdfDocModel } from "@fittrack/shared";
import { pageLabel, pairUp, pdfSafe, renderPdf } from "./renderPdf";

const small: PdfDocModel = {
  fileName: "fittrack-report-2026-03-05_to_2026-03-11.pdf",
  title: "FitTrack report",
  blocks: [
    { type: "title", text: "FitTrack report" },
    { type: "subtitle", text: "5 Mar - 11 Mar 2026 – generated 31 Oct 2026, 14:05 IST" },
    { type: "stats", items: [{ label: "Days logged", value: "5 of 7" }, { label: "Average in", value: "1,900 kcal", note: "logged days" }, { label: "Avg net (estimated)", value: "-250 kcal" }] },
    { type: "table", title: "Daily", head: ["Date", "In", "Out (est.)"], rows: [["5 Mar", "1,900", "2,150"]] },
    { type: "bullets", title: "Insights", items: ["You logged 5 of 7 days. A very long insight sentence that needs wrapping ".repeat(4)] },
    { type: "chart", id: "inOut", title: "Calories in vs out", alt: "Calories in vs out: average 1,900 in and 2,150 out (estimated)." },
    { type: "note", text: "BMI and calorie figures are estimates and not medical advice. Calories out are estimated." },
  ],
};

const head = (b: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(b).slice(0, 5));

describe("renderPdf", () => {
  it("produces a PDF with at least one page, falling back to alt text for charts", async () => {
    const r = await renderPdf(small);
    expect(head(r.bytes)).toBe("%PDF-");
    expect(r.pages).toBeGreaterThanOrEqual(1);
  });

  it("survives a chart provider that throws", async () => {
    const r = await renderPdf(small, async () => { throw new Error("tainted"); });
    expect(head(r.bytes)).toBe("%PDF-");
  });

  it("falls back when the provider returns a garbage image", async () => {
    const r = await renderPdf(small, async () => ({ dataUrl: "data:image/png;base64,AAAA", width: 100, height: 50 }));
    expect(head(r.bytes)).toBe("%PDF-");
  });

  it("paginates a long table", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => [`Day ${i + 1}`, String(1500 + i), "2,100", "-300"]);
    const long: PdfDocModel = { ...small, blocks: [...small.blocks.slice(0, 2), { type: "table", title: "Daily", head: ["Date", "In", "Out", "Net"], rows }, small.blocks[6]!] };
    const r = await renderPdf(long);
    expect(r.pages).toBeGreaterThan(1);
  });
});

describe("pdf helpers", () => {
  it("pairs stats and labels pages", () => {
    expect(pairUp([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(pageLabel(2, 5)).toBe("Page 2 of 5");
  });
  it("maps unsupported characters", () => {
    expect(pdfSafe("a–b ≈ 中")).toBe("a-b ~ ?");
  });
});
