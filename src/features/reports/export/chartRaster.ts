/** Chart rasterisation for the PDF. Pure helpers are separate from the DOM function so they can be unit tested. */

/** The tiny slice of an element the inliner needs (real Elements satisfy it). */
export interface StyledEl {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

export const INLINE_PROPS = [
  "fill", "stroke", "stroke-width", "stroke-opacity", "fill-opacity", "opacity", "stroke-dasharray",
  "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline",
] as const;

const LIGHT_INK = "#111111";

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
        const v = lightPaint(orig.getAttribute(prop), raw);
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("chart image failed to load"));
    img.src = src;
  });
}

/** Rasterise the on-screen chart with this id; returns null whenever anything is missing or fails. */
export async function rasterizeChart(id: string, root: ParentNode = document): Promise<ChartImage | null> {
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
    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`);
    const canvas = document.createElement("canvas");
    canvas.width = width * SCALE;
    canvas.height = height * SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png"); // throws if the canvas is tainted
    return { dataUrl, width, height };
  } catch {
    return null;
  }
}
