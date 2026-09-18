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
import { platform } from "node:os";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const ROOT = join(import.meta.dirname, "..");
const ICONS = join(ROOT, "src-tauri", "icons");
const WIN = platform() === "win32";
const INK = "#0a0b0a";
const CREAM = "#d7dbd4";
const INK_RGB = [0x0a, 0x0b, 0x0a];
const CREAM_RGB = [0xd7, 0xdb, 0xd4];
const ICO_SIZES = [16, 24, 32, 48, 64, 256];

const MARK_SVG = `
<rect width="32" height="32" fill="${INK}"/>
<g transform="translate(16 16)">
  <path d="M-4.7-12.3h9.4c.7 0 1.2.5 1.2 1.15v1.55H-5.9v-1.55c0-.65.5-1.15 1.2-1.15z" fill="${CREAM}"/>
  <rect x="-4.3" y="-9.6" width="8.6" height="1.85" rx="0.5" fill="${CREAM}"/>
  <path d="M-2.45-7.75h4.9v3.15c2.55 1.2 6.15 3.45 6.15 8.85a8.6 8.6 0 1 1-17.2 0c0-5.4 3.6-7.65 6.15-8.85v-3.15z" fill="${CREAM}"/>
  <path d="M-3.05-.35v9.15h1.95V5.25h1.55c2.7 0 4.25-1.4 4.25-3.45 0-2.05-1.45-2.15-3.95-2.15H-3.05zm1.95 1.65h1.7c1.35 0 2.15.4 2.15 1.35s-.8 1.45-2.15 1.45h-1.7V1.3z" fill="${INK}"/>
</g>
`;

function drawHtml(size) {
  return `<!doctype html>
<html><body style="margin:0;background:${INK}">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" shape-rendering="geometricPrecision">
${MARK_SVG}
</svg>
</body></html>`;
}

function inFlask(x, y) {
  if (x >= 11.3 && x <= 20.7 && y >= 3.7 && y <= 6.4) return true;
  if (x >= 11.7 && x <= 20.3 && y >= 6.4 && y <= 8.25) return true;
  if (x >= 13.55 && x <= 18.45 && y >= 8.25 && y <= 12.2) return true;
  const dx = x - 16;
  const dy = y - 20.25;
  return dx * dx + dy * dy <= 8.6 * 8.6;
}

function inP(x, y) {
  if (x >= 12.95 && x <= 14.9 && y >= 15.65 && y <= 24.8) return true;
  const inBowl = x >= 12.95 && x <= 17.2 && y >= 15.65 && y <= 19.1;
  if (!inBowl) return false;
  const inHole = x >= 14.9 && x <= 16.85 && y >= 17.3 && y <= 19.0;
  return !inHole;
}

/** Same mark as the SVG, as RGBA — used for the BMP .ico. */
function rgbaAt(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size) * 32;
      const y = ((py + 0.5) / size) * 32;
      const cream = inFlask(x, y) && !inP(x, y);
      const rgb = cream ? CREAM_RGB : INK_RGB;
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
const png32 = await pngAt(32);
const png64 = await pngAt(64);
const png128 = await pngAt(128);
const png256 = await pngAt(256);
const png512 = await pngAt(512);
const png1024 = await pngAt(1024);
const png192 = await pngAt(192);
const png180 = await pngAt(180);
await browser.close();

writeFileSync(join(ICONS, "32x32.png"), png32);
writeFileSync(join(ICONS, "64x64.png"), png64);
writeFileSync(join(ICONS, "128x128.png"), png128);
writeFileSync(join(ICONS, "128x128@2x.png"), png256);
writeFileSync(join(ICONS, "icon.png"), png512);
writeFileSync(join(ICONS, "icon-source.png"), png1024);

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
