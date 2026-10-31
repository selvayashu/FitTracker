/** Chart rasterisation for the PDF. Pure helpers are separate from the DOM function so they can be unit tested. */

/** The tiny slice of an element the inliner needs (real Elements satisfy it). */
export interface StyledEl {
  tagName?: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

export const INLINE_PROPS = [
  "fill", "stroke", "stroke-width", "stroke-opacity", "fill-opacity", "opacity", "stroke-dasharray",
  "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline",
] as const;

const LIGHT_INK = "#111111";

export function isTextTag(tag: string | undefined): boolean {
  return tag != null && /^(text|tspan)$/i.test(tag);
}

/** Relative luminance (0..1) of "#rgb", "#rrggbb" or "rgb(a)(r, g, b)"; null when unparseable. */
export function colorLuminance(color: string): number | null {
  const c = color.trim().toLowerCase();
  let r: number, g: number, b: number;
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) { const h = m[1]!; r = parseInt(h[0]! + h[0]!, 16); g = parseInt(h[1]! + h[1]!, 16); b = parseInt(h[2]! + h[2]!, 16); }
  else if ((m = /^#([0-9a-f]{6})$/.exec(c))) { const h = m[1]!; r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16); }
  else if ((m = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(c))) { r = +m[1]!; g = +m[2]!; b = +m[3]!; }
  else return null;
  const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** True for colours that would vanish on the white PDF background (relative luminance above 0.6). */
export function isLightColor(color: string): boolean {
  const l = colorLuminance(color);
  return l != null && l > 0.6;
}

/** Light-theme paint: `currentColor` (which follows the dark/light theme on screen) becomes dark ink. */
export function lightPaint(attr: string | null, computed: string | undefined): string | null {
  if (attr != null && /currentcolor/i.test(attr)) return LIGHT_INK;
  if (computed == null || computed === "") return null;
  if (/currentcolor/i.test(computed)) return LIGHT_INK;
  return computed;
}

/** Copy the style properties that matter from each original node to its clone as attributes. */
export function inlineStyles(pairs: Array<[StyledEl, StyledEl]>, computed: (el: StyledEl) => Record<string, string>): void {
  for (const [orig, clone] of pairs) {
    const cs = computed(orig);
    for (const prop of INLINE_PROPS) {
      const raw = cs[prop];
      if (prop === "fill" || prop === "stroke") {
        let v = lightPaint(orig.getAttribute(prop), raw);
        if (prop === "fill" && v != null && isTextTag(orig.tagName) && isLightColor(v)) v = LIGHT_INK;
        if (v != null) clone.setAttribute(prop, v);
      } else if (raw != null && raw !== "" && raw !== "normal") {
        clone.setAttribute(prop, raw);
      }
    }
  }
}

export interface ChartImage { dataUrl: string; width: number; height: number }

/** Scale to the available width, never exceeding maxHeight (mm or any unit). */
export function fitImage(width: number, height: number, maxWidth: number, maxHeight: number): { w: number; h: number } {
  if (!(width > 0) || !(height > 0) || !(maxWidth > 0) || !(maxHeight > 0)) return { w: 0, h: 0 };
  let w = maxWidth;
  let h = (height / width) * w;
  if (h > maxHeight) { h = maxHeight; w = (width / height) * h; }
  return { w, h };
}

/** Decide how a chart block is printed: image when we have a usable raster, else the alt text. */
export function chartFallbackDecision(img: ChartImage | null | undefined): "image" | "alt" {
  return img != null && img.dataUrl.startsWith("data:image/png") && img.width > 0 && img.height > 0 ? "image" : "alt";
}

const SCALE = 2;
export const IMAGE_TIMEOUT_MS = 5000;

/** Plain data captured synchronously from the on-screen chart, so later awaits cannot see a different range. */
export interface ChartSnapshot { xml: string; width: number; height: number }

export type ImageLoader = (src: string) => Promise<CanvasImageSource>;

function defaultLoader(src: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("chart image failed to load"));
    img.src = src;
  });
}

/** Resolve to null if the loader fails or does not settle within timeoutMs. */
export function loadWithTimeout(src: string, loader: ImageLoader = defaultLoader, timeoutMs = IMAGE_TIMEOUT_MS): Promise<CanvasImageSource | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    loader(src).then(
      (img) => { clearTimeout(timer); resolve(img); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

/** SYNCHRONOUS: serialise the on-screen chart with this id into plain data (null when missing). */
export function snapshotChart(id: string, root: ParentNode = document): ChartSnapshot | null {
  try {
    const holder = root.querySelector(`[data-chart-id="${id}"]`);
    const svg = holder?.querySelector("svg");
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    if (width < 10 || height < 10) return null;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    const origs: Element[] = [svg, ...Array.from(svg.querySelectorAll("*"))];
    const clones: Element[] = [clone, ...Array.from(clone.querySelectorAll("*"))];
    if (origs.length !== clones.length) return null;
    inlineStyles(
      origs.map((o, i): [StyledEl, StyledEl] => [o, clones[i]!]),
      (el) => {
        const cs = window.getComputedStyle(el as Element);
        const out: Record<string, string> = {};
        for (const p of INLINE_PROPS) out[p] = cs.getPropertyValue(p);
        return out;
      },
    );
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("color", LIGHT_INK);
    clone.setAttribute("style", `color:${LIGHT_INK};background:#ffffff`);
    const xml = new XMLSerializer().serializeToString(clone).replace(/currentColor/gi, LIGHT_INK);
    return { xml, width, height };
  } catch {
    return null;
  }
}

/** Draw a snapshot to a 2x canvas on white; null on any failure or timeout. */
export async function rasterizeSnapshot(snap: ChartSnapshot | null, loader: ImageLoader = defaultLoader, timeoutMs = IMAGE_TIMEOUT_MS): Promise<ChartImage | null> {
  if (!snap) return null;
  try {
    const img = await loadWithTimeout(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(snap.xml)}`, loader, timeoutMs);
    if (!img) return null;
    const canvas = document.createElement("canvas");
    canvas.width = snap.width * SCALE;
    canvas.height = snap.height * SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/png"), width: snap.width, height: snap.height }; // throws if tainted
  } catch {
    return null;
  }
}
