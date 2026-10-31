/** Blob download helper. Works on desktop and mobile browsers: object URL on a temporary anchor with `download`. */

export function makeBlob(content: BlobPart, mime: string): Blob {
  return new Blob([content], { type: mime });
}

export const CSV_MIME = "text/csv;charset=utf-8";
export const PDF_MIME = "application/pdf";

/** Strip path separators and control characters so the browser never sees a hostile file name. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "download";
}

export interface DownloadEnv {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  createAnchor: () => { href: string; download: string; rel: string; style: { display: string }; click: () => void; remove: () => void };
  append: (el: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
}

function browserEnv(): DownloadEnv {
  return {
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    createAnchor: () => document.createElement("a"),
    append: (el) => document.body.appendChild(el as Node),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  };
}

/** Trigger a file download. Returns the (sanitised) file name that was used. */
export function downloadBlob(content: BlobPart, filename: string, mime: string, env: DownloadEnv = browserEnv()): string {
  const name = safeFileName(filename);
  const url = env.createObjectURL(makeBlob(content, mime));
  const a = env.createAnchor();
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  env.append(a);
  a.click();
  a.remove();
  env.setTimeout(() => env.revokeObjectURL(url), 4000);
  return name;
}
