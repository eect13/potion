#!/usr/bin/env node
/**
 * Regenerate Android adaptive / legacy launcher mipmaps with safe-zone padding.
 * Tauri `icon` fills the canvas edge-to-edge; OEM masks then crop the mark.
 * Flask sits inside the adaptive FG so OEM masks leave an ink frame.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inCream } from "./potion-mark-geom.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src-tauri", "icons", "android");
const INK = [0x0a, 0x0b, 0x0a, 255];
const CREAM = [0xd7, 0xdb, 0xd4, 255];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crcB]);
}

function pngRGBA(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawMark(size, markFrac) {
  const rgba = Buffer.alloc(size * size * 4);
  const mark = size * markFrac;
  const ox = (size - mark) / 2;
  const oy = (size - mark) / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      const x = ((px + 0.5 - ox) / mark) * 32;
      const y = ((py + 0.5 - oy) / mark) * 32;
      const cream = inCream(x, y);
      const c = cream ? CREAM : INK;
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

const DENSITIES = {
  "mipmap-mdpi": { launcher: 48, foreground: 108 },
  "mipmap-hdpi": { launcher: 72, foreground: 162 },
  "mipmap-xhdpi": { launcher: 96, foreground: 216 },
  "mipmap-xxhdpi": { launcher: 144, foreground: 324 },
  "mipmap-xxxhdpi": { launcher: 192, foreground: 432 },
};

for (const [folder, sizes] of Object.entries(DENSITIES)) {
  const dir = join(OUT, folder);
  mkdirSync(dir, { recursive: true });
  const fg = pngRGBA(sizes.foreground, sizes.foreground, drawMark(sizes.foreground, 0.44));
  writeFileSync(join(dir, "ic_launcher_foreground.png"), fg);
  const full = pngRGBA(sizes.launcher, sizes.launcher, drawMark(sizes.launcher, 0.72));
  writeFileSync(join(dir, "ic_launcher.png"), full);
  writeFileSync(join(dir, "ic_launcher_round.png"), full);
}

const values = join(OUT, "values");
mkdirSync(values, { recursive: true });
writeFileSync(
  join(values, "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0A0B0A</color>
</resources>
`,
);

console.log("Android launcher icons: flask FG 44%, legacy 72% (ink frame).");
