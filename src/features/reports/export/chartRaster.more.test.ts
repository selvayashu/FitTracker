import { describe, expect, it } from "vitest";
import { colorLuminance, inlineStyles, isLightColor, loadWithTimeout, rasterizeSnapshot, type ImageLoader, type StyledEl } from "./chartRaster";

function el(tagName: string): StyledEl & { attrs: Record<string, string> } {
  const a: Record<string, string> = {};
  return { tagName, attrs: a, getAttribute: (n) => a[n] ?? null, setAttribute: (n, v) => { a[n] = v; } };
}

describe("luminance", () => {
  it("classifies light and dark colours", () => {
    expect(isLightColor("rgb(226, 232, 240)")).toBe(true);
    expect(isLightColor("#fff")).toBe(true);
    expect(isLightColor("#94a3b8")).toBe(false);
    expect(isLightColor("rgb(17,17,17)")).toBe(false);
    expect(isLightColor("none")).toBe(false);
    expect(colorLuminance("#000000")).toBe(0);
    expect(colorLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
  it("forces dark ink for light text fills only", () => {
    const text = el("text");
    const rect = el("rect");
    const tc = el("text");
    const rc = el("rect");
    inlineStyles([[text, tc], [rect, rc]], () => ({ fill: "rgb(226, 232, 240)" }));
    expect(tc.attrs.fill).toBe("#111111");
    expect(rc.attrs.fill).toBe("rgb(226, 232, 240)");
  });
});

describe("image load timeout", () => {
  it("resolves null when the loader never settles", async () => {
    const never: ImageLoader = () => new Promise(() => undefined);
    expect(await loadWithTimeout("data:x", never, 20)).toBeNull();
    expect(await rasterizeSnapshot({ xml: "<svg/>", width: 10, height: 10 }, never, 20)).toBeNull();
  });
  it("resolves null on loader error and the image on success", async () => {
    expect(await loadWithTimeout("x", () => Promise.reject(new Error("bad")), 50)).toBeNull();
    const img = {} as CanvasImageSource;
    expect(await loadWithTimeout("x", () => Promise.resolve(img), 50)).toBe(img);
  });
});
