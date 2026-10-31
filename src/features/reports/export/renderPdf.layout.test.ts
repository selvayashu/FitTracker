import { describe, expect, it } from "vitest";
import type { PdfDocModel } from "@fittrack/shared";
import { LOSSY_NOTE, pdfSafeInfo, renderPdf } from "./renderPdf";

const base: PdfDocModel = { fileName: "x.pdf", title: "FitTrack report", blocks: [] };

describe("stats layout independence", () => {
  const stats = {
    type: "stats" as const,
    items: [
      { label: "A fairly long label that will need to wrap in the narrow column box ".repeat(3), value: "1,234 kcal per day on average here ".repeat(3), note: "a long note that wraps as well across lines in the box ".repeat(3) },
      { label: "Days logged", value: "5 of 7" },
    ],
  };
  it("gives the same box heights and wrapped line counts after a title or after a note", async () => {
    const afterTitle = await renderPdf({ ...base, blocks: [{ type: "title", text: "Big" }, stats] });
    const afterNote = await renderPdf({ ...base, blocks: [{ type: "note", text: "tiny" }, stats] });
    expect(afterTitle.statsLayout).toEqual(afterNote.statsLayout);
    expect(afterTitle.statsLayout[0]!.lineCounts.some((n) => n > 1)).toBe(true);
  });
});

describe("lossy characters", () => {
  it("keeps Latin-1 and flags Tamil, emoji and C1 controls", () => {
    expect(pdfSafeInfo("café")).toEqual({ text: "café", replaced: false });
    expect(pdfSafeInfo("இட்லி").replaced).toBe(true);
    expect(pdfSafeInfo("pizza \u{1F355}")).toEqual({ text: "pizza ?", replaced: true });
    expect(pdfSafeInfo("a\u0085b").replaced).toBe(true);
  });
  it("reports lossy only when characters were replaced", async () => {
    const tamil: PdfDocModel = { ...base, blocks: [{ type: "bullets", title: "Foods", items: ["இட்லி"] }] };
    const plain: PdfDocModel = { ...base, blocks: [{ type: "bullets", title: "Foods", items: ["café"] }] };
    expect((await renderPdf(tamil)).lossy).toBe(true);
    expect((await renderPdf(plain)).lossy).toBe(false);
    expect(LOSSY_NOTE).toMatch(/preserved in the CSV/);
  });
});
