import { describe, expect, it } from "vitest";
import { chartFallbackDecision, fitImage, inlineStyles, lightPaint, type StyledEl } from "./chartRaster";

function el(attrs: Record<string, string> = {}): StyledEl & { attrs: Record<string, string> } {
  const a = { ...attrs };
  return { attrs: a, getAttribute: (n) => a[n] ?? null, setAttribute: (n, v) => { a[n] = v; } };
}

describe("lightPaint", () => {
  it("forces dark ink for currentColor", () => {
    expect(lightPaint("currentColor", "rgb(200,200,200)")).toBe("#111111");
    expect(lightPaint(null, "currentcolor")).toBe("#111111");
  });
  it("keeps concrete colours and handles missing values", () => {
    expect(lightPaint("#0072B2", "rgb(0, 114, 178)")).toBe("rgb(0, 114, 178)");
    expect(lightPaint(null, "")).toBeNull();
    expect(lightPaint(null, undefined)).toBeNull();
  });
});

describe("inlineStyles", () => {
  it("copies computed props onto the clone and fixes theme colours", () => {
    const o = el({ fill: "currentColor" });
    const c = el();
    inlineStyles([[o, c]], () => ({ fill: "rgb(226,232,240)", stroke: "none", "font-size": "10px", "font-weight": "normal" }));
    expect(c.attrs.fill).toBe("#111111");
    expect(c.attrs.stroke).toBe("none");
    expect(c.attrs["font-size"]).toBe("10px");
    expect(c.attrs["font-weight"]).toBeUndefined();
  });
});

describe("fitImage / fallback", () => {
  it("scales to width and caps height", () => {
    expect(fitImage(400, 200, 100, 100)).toEqual({ w: 100, h: 50 });
    const r = fitImage(100, 400, 100, 50);
    expect(r.h).toBe(50);
    expect(r.w).toBe(12.5);
    expect(fitImage(0, 10, 100, 100)).toEqual({ w: 0, h: 0 });
  });
  it("uses alt text unless a valid PNG exists", () => {
    expect(chartFallbackDecision(null)).toBe("alt");
    expect(chartFallbackDecision({ dataUrl: "data:,", width: 1, height: 1 })).toBe("alt");
    expect(chartFallbackDecision({ dataUrl: "data:image/png;base64,AAA", width: 10, height: 5 })).toBe("image");
  });
});
