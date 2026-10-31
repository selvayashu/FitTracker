// Generates the PWA icons in /public from the same geometry as public/icon.svg (no native dependencies).
// Usage: npm run icons
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BG = [0x0f, 0x76, 0x6e];
const FG = [0xff, 0xff, 0xff];
// Pulse line in the 512 x 512 design space (matches icon.svg).
const PTS = [[96, 272], [184, 272], [220, 176], [284, 352], [336, 232], [364, 272], [416, 272]];
const STROKE = 30;

function distToSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function render(size, scale) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4; // supersampling per axis
  const k = 512 / size; // pixel -> design space
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        // design-space point, then undo the content scale around the centre
        const dxp = (x + (sx + 0.5) / SS) * k, dyp = (y + (sy + 0.5) / SS) * k;
        const qx = 256 + (dxp - 256) / scale, qy = 256 + (dyp - 256) / scale;
        let d = Infinity;
        for (let i = 0; i < PTS.length - 1; i++) d = Math.min(d, distToSeg(qx, qy, PTS[i], PTS[i + 1]));
        if (d <= STROKE / 2) cov++;
      }
      const a = cov / (SS * SS), o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
      px[o + 3] = 255;
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const targets = [
  ["pwa-192x192.png", 192, 1],
  ["pwa-512x512.png", 512, 1],
  ["maskable-icon-512x512.png", 512, 0.66], // content inside the 80% safe zone
  ["apple-touch-icon-180x180.png", 180, 0.9],
];
for (const [name, size, scale] of targets) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size, render(size, scale)));
  console.log("wrote public/" + name);
}
