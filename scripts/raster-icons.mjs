#!/usr/bin/env node
/**
 * Scale the source flask PNG onto tiles. Do not redraw the mark.
 * Playwright rasters + Windows BMP .ico (PNG-in-ICO is a white square in Explorer).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { chromium } from "playwright";
import { CREAM, INK, LOGO_PAD, logoPlacement } from "./potion-mark-geom.mjs";

const ROOT = join(import.meta.dirname, "..");
const ICONS = join(ROOT, "src-tauri", "icons");
const PUBLIC = join(ROOT, "public");
const LOGO_PNG = join(PUBLIC, "potion-logo.png");
const MASK_PNG = join(PUBLIC, "potion-logo-mask.png");
const ICO_SIZES = [16, 24, 32, 48, 64, 256];

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function applyFilter(type, cur, prev, bpp) {
  for (let i = 0; i < cur.length; i++) {
    const left = i >= bpp ? cur[i - bpp] : 0;
    const up = prev[i];
    const ul = i >= bpp ? prev[i - bpp] : 0;
    let x = cur[i];
    if (type === 1) x += left;
    else if (type === 2) x += up;
    else if (type === 3) x += (left + up) >> 1;
    else if (type === 4) x += paeth(left, up, ul);
    cur[i] = x & 255;
  }
}

function decodePng(buf) {
  if (buf[0] !== 137 || buf[1] !== 80) throw new Error("not a PNG");
  let off = 8;
  let w = 0;
  let h = 0;
  let depth = 8;
  let ctype = 6;
  const idats = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (depth !== 8 || (ctype !== 2 && ctype !== 6)) {
    throw new Error(`unsupported png depth=${depth} color=${ctype}`);
  }
  const bpp = ctype === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idats));
  const stride = w * bpp;
  const rgba = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  let src = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[src++];
    raw.copy(cur, 0, src, src + stride);
    src += stride;
    applyFilter(filter, cur, prev, bpp);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const j = x * bpp;
      rgba[i] = cur[j];
      rgba[i + 1] = cur[j + 1];
      rgba[i + 2] = cur[j + 2];
      rgba[i + 3] = bpp === 4 ? cur[j + 3] : 255;
    }
    cur.copy(prev);
  }
  return { w, h, rgba };
}

function bmp32(size, rgba) {
  const xor = size * size * 4;
  const buf = Buffer.alloc(40 + xor);
  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(size, 4);
  buf.writeInt32LE(size * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  let o = 40;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      buf[o++] = rgba[i + 2];
      buf[o++] = rgba[i + 1];
      buf[o++] = rgba[i];
      buf[o++] = 255;
    }
  }
  return buf;
}

function icoFromBmp(images) {
  const header = 6 + 16 * images.length;
  const out = Buffer.alloc(header + images.reduce((s, im) => s + im.buf.length, 0));
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(images.length, 4);
  let p = 6;
  let offset = header;
  for (const im of images) {
    out.writeUInt8(im.size >= 256 ? 0 : im.size, p);
    out.writeUInt8(im.size >= 256 ? 0 : im.size, p + 1);
    out.writeUInt8(0, p + 2);
    out.writeUInt8(0, p + 3);
    out.writeUInt16LE(1, p + 4);
    out.writeUInt16LE(32, p + 6);
    out.writeUInt32LE(im.buf.length, p + 8);
    out.writeUInt32LE(offset, p + 12);
    p += 16;
    im.buf.copy(out, offset);
    offset += im.buf.length;
  }
  return out;
}

const logoData = `data:image/png;base64,${readFileSync(LOGO_PNG).toString("base64")}`;
const maskData = `data:image/png;base64,${readFileSync(MASK_PNG).toString("base64")}`;

function tileHtml(size, { rounded = true, padFrac = LOGO_PAD } = {}) {
  const radius = rounded ? Math.round(size * 0.25) : 0;
  const inset = `${padFrac * 100}%`;
  return `<!doctype html><html><body style="margin:0">
<div style="width:${size}px;height:${size}px;background:${INK};border-radius:${radius}px;position:relative;overflow:hidden">
  <div style="position:absolute;inset:${inset};background:${CREAM};-webkit-mask-image:url(${logoData});mask-image:url(${logoData});-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center"></div>
</div></body></html>`;
}

const favPlace = logoPlacement(32, LOGO_PAD);
writeFileSync(
  join(PUBLIC, "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="${INK}"/>
  <defs>
    <mask id="flask" maskUnits="userSpaceOnUse">
      <image href="${maskData}" xlink:href="${maskData}" x="${favPlace.x}" y="${favPlace.y}" width="${favPlace.w}" height="${favPlace.h}" preserveAspectRatio="xMidYMid meet"/>
    </mask>
  </defs>
  <rect width="32" height="32" fill="${CREAM}" mask="url(#flask)"/>
</svg>
`,
);

const browser = await chromium.launch({ args: ["--disable-gpu"] });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function pngAt(size, opts = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(tileHtml(size, opts), { waitUntil: "load" });
  return Buffer.from(await page.screenshot({ type: "png", omitBackground: false }));
}

mkdirSync(ICONS, { recursive: true });

const png1024 = await pngAt(1024, { rounded: true });
const png512 = await pngAt(512, { rounded: true });
const png256 = await pngAt(256, { rounded: true });
const png192 = await pngAt(192, { rounded: true });
const png180 = await pngAt(180, { rounded: true });
const png128 = await pngAt(128, { rounded: true });
const png64 = await pngAt(64, { rounded: true });
const png32 = await pngAt(32, { rounded: true });

writeFileSync(join(ICONS, "icon-source.png"), png1024);
writeFileSync(join(ICONS, "icon.png"), png1024);
writeFileSync(join(ICONS, "128x128@2x.png"), png256);
writeFileSync(join(ICONS, "128x128.png"), png128);
writeFileSync(join(ICONS, "64x64.png"), png64);
writeFileSync(join(ICONS, "32x32.png"), png32);

const icoImages = [];
for (const size of ICO_SIZES) {
  const png = await pngAt(size, { rounded: true });
  const decoded = decodePng(png);
  if (decoded.w !== size || decoded.h !== size) {
    throw new Error(`png ${size} decoded as ${decoded.w}x${decoded.h}`);
  }
  icoImages.push({ size, buf: bmp32(size, decoded.rgba) });
}

const ico = icoFromBmp(icoImages);
const firstOff = ico.readUInt32LE(18);
if (ico.readUInt32LE(firstOff) !== 40) {
  console.error("ico first image is not a BMP DIB (Explorer would show a white square)");
  process.exit(1);
}
writeFileSync(join(ICONS, "icon.ico"), ico);

const grok = join(PUBLIC, "__grok");
mkdirSync(grok, { recursive: true });
copyFileSync(join(ICONS, "32x32.png"), join(PUBLIC, "icon-32.png"));
writeFileSync(join(PUBLIC, "favicon.ico"), ico);
writeFileSync(join(PUBLIC, "icon-192.png"), png192);
writeFileSync(join(PUBLIC, "icon-180.png"), png180);
writeFileSync(join(grok, "icon-180.png"), png180);
writeFileSync(join(PUBLIC, "icon-512.png"), png512);

const DENSITIES = {
  "mipmap-mdpi": { launcher: 48, foreground: 108 },
  "mipmap-hdpi": { launcher: 72, foreground: 162 },
  "mipmap-xhdpi": { launcher: 96, foreground: 216 },
  "mipmap-xxhdpi": { launcher: 144, foreground: 324 },
  "mipmap-xxxhdpi": { launcher: 192, foreground: 432 },
};
const androidRoot = join(ICONS, "android");
for (const [folder, sizes] of Object.entries(DENSITIES)) {
  const dir = join(androidRoot, folder);
  mkdirSync(dir, { recursive: true });
  const fg = await pngAt(sizes.foreground, { rounded: false, padFrac: 0.28 });
  const full = await pngAt(sizes.launcher, { rounded: false, padFrac: 0.14 });
  writeFileSync(join(dir, "ic_launcher_foreground.png"), fg);
  writeFileSync(join(dir, "ic_launcher.png"), full);
  writeFileSync(join(dir, "ic_launcher_round.png"), full);
}

const values = join(androidRoot, "values");
mkdirSync(values, { recursive: true });
writeFileSync(
  join(values, "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0A0B0A</color>
</resources>
`,
);

await browser.close();
console.log(`Icons ready from source flask PNG (BMP ico ${ico.length}B).`);
