import { describe, expect, it, vi } from "vitest";
import { CSV_MIME, PDF_MIME, downloadBlob, makeBlob, safeFileName, type DownloadEnv } from "./download";

describe("download helper", () => {
  it("builds a Blob with the given type and untouched content (BOM kept)", async () => {
    const b = makeBlob("\uFEFFa,b\r\n1,2", CSV_MIME);
    expect(b.type).toBe(CSV_MIME);
    const bytes = Array.from(new Uint8Array(await b.arrayBuffer()).slice(0, 4));
    expect(bytes).toEqual([0xef, 0xbb, 0xbf, 0x61]);
  });

  it("sanitises file names", () => {
    expect(safeFileName("a/b\\c:d.csv")).toBe("a_b_c_d.csv");
    expect(safeFileName("  ")).toBe("download");
    expect(safeFileName("fittrack-report-2026-03-05_to_2026-03-11.pdf")).toBe("fittrack-report-2026-03-05_to_2026-03-11.pdf");
  });

  it("clicks a temporary anchor and revokes the URL later", () => {
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = { href: "", download: "", rel: "", style: { display: "" }, click, remove };
    const revoke = vi.fn();
    const later: Array<() => void> = [];
    const delays: number[] = [];
    const env: DownloadEnv = {
      createObjectURL: vi.fn(() => "blob:x"),
      revokeObjectURL: revoke,
      createAnchor: () => anchor,
      append: vi.fn(),
      setTimeout: (fn, ms) => { later.push(fn); delays.push(ms); return 1; },
    };
    const name = downloadBlob("x", "f.pdf", PDF_MIME, env);
    expect(name).toBe("f.pdf");
    expect(anchor.href).toBe("blob:x");
    expect(anchor.download).toBe("f.pdf");
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    expect(delays[0]).toBeGreaterThanOrEqual(60_000);
    later[0]!();
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});
