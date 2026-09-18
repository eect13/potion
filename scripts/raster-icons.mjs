#!/usr/bin/env node
/**
 * Opaque ink-tile flask+P → PNG set + Windows **BMP** .ico.
 * PNG-in-ICO is a white square on the shortcut and the taskbar
 * (Explorer does not paint PNG entries at 16/32/48).
 *
 * ICO pixels are drawn in Node (not canvas getImageData — Chromium headless
 * often returns a black buffer for alpha:false canvases).
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { CREAM, CREAM_RGB, INK, INK_RGB, MARK_CUTS, MARK_FLASK, inCream } from "./potion-mark-geom.mjs";

const ROOT = join(import.meta.dirname, "..");
const ICONS = join(ROOT, "src-tauri", "icons");
const ICO_SIZES = [16, 24, 32, 48, 64, 256];

function drawHtml(size) {
  return `<!doctype html>
<html><body style="margin:0;background:${INK}">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" shape-rendering="geometricPrecision">
  <rect width="32" height="32" fill="${INK}"/>
  <g transform="translate(16 16)">
    <g fill="${CREAM}">${MARK_FLASK}</g>
    <g fill="${INK}">${MARK_CUTS}</g>
  </g>
</svg>
</body></html>`;
}

/** Same mark as the SVG, as RGBA — used for the BMP .ico. */
function rgbaAt(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size) * 32;
      const y = ((py + 0.5) / size) * 32;
      const rgb = inCream(x, y) ? CREAM_RGB : INK_RGB;
      const i = (py * size + px) * 4;
      rgba[i] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
      rgba[i + 3] = 255;
    }
  }
  if (rgba[0] !== INK_RGB[0] || rgba[1] !== INK_RGB[1] || rgba[2] !== INK_RGB[2]) {
    throw new Error("ink tile raster produced a non-ink pixel");
  }
  return rgba;
}

/** 32-bit BMP DIB (bottom-up BGRA + zero AND mask). What Explorer reads. */
function bmp32(size, rgba) {
  const xor = size * size * 4;
  const andRow = Math.ceil(size / 32) * 4;
  const buf = Buffer.alloc(40 + xor + andRow * size);
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

const browser = await chromium.launch({ args: ["--disable-gpu"] });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function pngAt(size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(drawHtml(size), { waitUntil: "load" });
  return Buffer.from(await page.screenshot({ type: "png", omitBackground: false }));
}

mkdirSync(ICONS, { recursive: true });
writeFileSync(join(ICONS, "icon-source.png"), await pngAt(1024));
writeFileSync(join(ICONS, "icon.png"), await pngAt(512));
writeFileSync(join(ICONS, "128x128@2x.png"), await pngAt(256));
writeFileSync(join(ICONS, "128x128.png"), await pngAt(128));
writeFileSync(join(ICONS, "64x64.png"), await pngAt(64));
writeFileSync(join(ICONS, "32x32.png"), await pngAt(32));
const png192 = await pngAt(192);
const png180 = await pngAt(180);
await browser.close();

const ico = icoFromBmp(ICO_SIZES.map((size) => ({ size, buf: bmp32(size, rgbaAt(size)) })));
const firstOff = ico.readUInt32LE(18);
if (ico.readUInt32LE(firstOff) !== 40) {
  console.error("ico first image is not a BMP DIB (Explorer would show a white square)");
  process.exit(1);
}
const b = ico[firstOff + 40];
const g = ico[firstOff + 41];
const r = ico[firstOff + 42];
if (r !== INK_RGB[0] || g !== INK_RGB[1] || b !== INK_RGB[2]) {
  console.error(`ico pixel is rgb(${r},${g},${b}), expected ink`);
  process.exit(1);
}
writeFileSync(join(ICONS, "icon.ico"), ico);

const publicDir = join(ROOT, "public");
const grok = join(publicDir, "__grok");
mkdirSync(grok, { recursive: true });
copyFileSync(join(ICONS, "32x32.png"), join(publicDir, "icon-32.png"));
copyFileSync(join(ICONS, "icon.png"), join(publicDir, "icon-512.png"));
writeFileSync(join(publicDir, "favicon.ico"), ico);
writeFileSync(join(publicDir, "icon-192.png"), png192);
writeFileSync(join(grok, "icon-180.png"), png180);

const androidIcons = spawnSync(process.execPath, [join(ROOT, "scripts", "android-launcher-icons.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});
if ((androidIcons.status ?? 1) !== 0) {
  console.error("android-launcher-icons failed");
  process.exit(1);
}

console.log(`Icons ready (BMP ico ${ico.length}B + flask PNGs).`);
