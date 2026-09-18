#!/usr/bin/env node
/**
 * Build Potion installers.
 *
 *   1. Check Node 22 + put Rust on PATH
 *   2. desktop-setup --build  (deps + tauri release)
 *        phase 1  Vite desktop UI
 *        phase 2  cargo --release  (minutes)
 *        phase 3  MSI / NSIS
 *   3. Collect MSI / NSIS from bundle/
 *   4. Open that folder
 *
 *   node scripts/deploy.mjs
 *   node scripts/deploy.mjs --no-open
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const WIN = platform() === "win32";
const noOpen = process.argv.includes("--no-open");

const INSTALLER_EXT = new Set([".msi", ".dmg", ".deb", ".rpm", ".appimage"]);

function log(step, msg) {
  console.log(`\n[${step}] ${msg}`);
}

function fail(msg, extra) {
  console.error(`\n✗ ${msg}`);
  if (extra) console.error(extra);
  process.exit(1);
}

function run(cmd, cmdArgs) {
  const bat = WIN && /\.(bat|cmd)$/i.test(String(cmd).replace(/^"|"$/g, ""));
  const r = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: "inherit",
    shell: bat,
    env: process.env,
    windowsHide: true,
  });
  return r.status ?? 1;
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "deps" || name === "incremental" || name === "build" || name === ".fingerprint") continue;
      walk(path, acc);
    } else {
      acc.push(path);
    }
  }
  return acc;
}

function isInstaller(path) {
  const ext = extname(path).toLowerCase();
  if (INSTALLER_EXT.has(ext)) return true;
  if (ext === ".exe" && /nsis|setup|potion/i.test(path)) return true;
  const base = path.split(/[/\\]/).pop() ?? "";
  return ext === "" && base === "potion";
}

console.log("Potion deploy — 4 steps. First time is slow; leave this window open.\n");
console.log("  Inside step 2 there are three phases:");
console.log("    1) Vite packs the UI     ← ends with “Phase 1 done”");
console.log("    2) cargo compiles Rust   ← several minutes, looks like a new process");
console.log("    3) MSI / NSIS installers ← Explorer opens the bundle folder\n");

if (!existsSync(join(ROOT, "package.json")) || !existsSync(join(ROOT, "scripts", "desktop-setup.mjs"))) {
  fail(
    "This is not the Potion folder.",
    "Unzip the GitHub download so deploy.bat sits next to package.json, then double-click it.",
  );
}
if (!existsSync(join(ROOT, "desktop.html"))) {
  fail("desktop.html is missing — the GitHub zip looks incomplete.");
}

log("1/4", "Tools");
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  fail(`Node.js 22+ required (you have ${process.version}).`, "https://nodejs.org — LTS installer.");
}
const cargoBin = join(homedir(), ".cargo", "bin");
if (existsSync(cargoBin) && !process.env.PATH?.includes(cargoBin)) {
  process.env.PATH = `${cargoBin}${delimiter}${process.env.PATH ?? ""}`;
}
console.log(`  Node ${process.version}`);
console.log(`  ${existsSync(join(cargoBin, WIN ? "cargo.exe" : "cargo")) ? "Rust cargo on PATH" : "Rust will install in step 2 if missing"}`);

log("2/4", "Install deps + compile release (Tauri)");
if (run(process.execPath, ["scripts/desktop-setup.mjs", "--build"]) !== 0) {
  fail(
    "Step 2 failed.",
    "desktop-setup.bat only runs the app. Use this script (deploy.bat) for installers.",
  );
}

log("3/4", "Find installers");
const bundleDir = join(ROOT, "src-tauri", "target", "release", "bundle");
const releaseDir = join(ROOT, "src-tauri", "target", "release");
const found = walk(bundleDir)
  .concat(walk(releaseDir).filter((p) => /[/\\]potion(\.exe)?$/i.test(p)))
  .filter((p, i, all) => all.indexOf(p) === i);
const show = found.filter(isInstaller);

if (show.length) {
  console.log("  Installers:");
  for (const p of show) console.log(`    ${p}`);
} else if (existsSync(bundleDir)) {
  console.log(`  bundle exists but no .msi/.exe yet:\n    ${bundleDir}`);
} else {
  fail("No bundle folder. The release compile did not finish.");
}

log("4/4", "Open output folder");
const openDir = existsSync(bundleDir) ? bundleDir : existsSync(releaseDir) ? releaseDir : null;
if (!noOpen && openDir) {
  if (WIN) spawnSync("explorer", [openDir], { shell: true, stdio: "ignore" });
  else if (platform() === "darwin") spawnSync("open", [openDir], { stdio: "ignore" });
  else spawnSync("xdg-open", [openDir], { stdio: "ignore" });
  console.log(`  ${openDir}`);
}

console.log(`
Done. Install the MSI or NSIS setup from bundle\\ — not target\\debug\\potion.exe.
Other PCs do not need Node or Rust. Install the NSIS setup (or MSI) and open Potion.
`);
