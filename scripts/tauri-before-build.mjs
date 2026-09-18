#!/usr/bin/env node
/**
 * Tauri hooks (cwd-safe — locates the repo from this file, not process.cwd()).
 *
 *   node scripts/tauri-before-build.mjs          # beforeBuildCommand — Vite SPA
 *   node scripts/tauri-before-build.mjs bundle   # beforeBundleCommand — after cargo
 *
 * `npm run build` still exists for the website (Nitro + migrate). Desktop
 * must not run that: it would rename the Windows tab to `db:migrate` and
 * print a fake DATABASE_URL warning after the UI is already packed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATIC = join(ROOT, ".vercel", "output", "static");
const INDEX = join(STATIC, "index.html");
const BIN = join(ROOT, "node_modules", ".bin");
const phase = process.argv[2] === "bundle" ? "bundle" : "frontend";

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function banner(title, body) {
  console.log(`
========================================
 ${title}
========================================
${body}`);
}

if (phase === "bundle") {
  banner(
    "Potion — phase 3/3: write installers",
    "  Rust finished. Packing MSI and/or NSIS next.\n  Leave this window open until Explorer opens the bundle folder.\n",
  );
  process.exit(0);
}

banner(
  "Potion — phase 1/3: pack the UI",
  "  Vite desktop bundle (not the website SSR build).\n",
);

// vite.config.ts switches to the SPA/static outDir only when a TAURI_* env is set.
// pack-android.mjs and plain `node scripts/tauri-before-build.mjs` must set one,
// or Vite runs the Nitro website build and never writes static/index.html.
const tauriEnv = {
  ...process.env,
  PATH: `${BIN}${delimiter}${process.env.PATH || ""}`,
  TAURI_ENV_PLATFORM:
    process.env.TAURI_ENV_PLATFORM || process.env.TAURI_PLATFORM || process.env.TAURI_ENV_FAMILY || "desktop",
};

const vite = spawnSync(
  process.execPath,
  [join(ROOT, "scripts", "with-app-env.mjs"), "vite", "build"],
  { cwd: ROOT, stdio: "inherit", env: tauriEnv, windowsHide: true },
);
if ((vite.status ?? 1) !== 0) {
  fail("Vite desktop build failed.");
}

const indexScript = spawnSync(process.execPath, [join(ROOT, "scripts", "ensure-tauri-index.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
  env: tauriEnv,
  windowsHide: true,
});
if ((indexScript.status ?? 1) !== 0) {
  fail("Could not write index.html for Tauri.");
}

if (!existsSync(INDEX)) {
  fail("index.html missing after the UI pack — Tauri would open a blank window.");
}
const html = readFileSync(INDEX, "utf8");
if (!html.includes("potion-root") || !/assets\/[^"' ]+\.js/.test(html)) {
  fail("index.html does not reference the hashed UI bundle (would be a blank window).");
}
if (html.includes("/src/main.tsx")) {
  fail("index.html still points at /src/main.tsx — the hashed bundle was not substituted.");
}

banner(
  "Phase 1 done — phase 2/3: compile Rust",
  "  cargo --release is next (first time often 5–15 minutes; LTO + size opt).\n  Do not close this window. Phase 3 (MSI/NSIS) starts after cargo.\n",
);
