#!/usr/bin/env node
/**
 * Tauri `frontendDist` is `.vercel/output/static`.
 * Vite emits `desktop.html` (hashed assets). Tauri loads `index.html`.
 * Only runs when TAURI_ENV_* is set — never overwrite the website SSR build.
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = dirname(import.meta.dirname);
const staticDir = join(root, ".vercel", "output", "static");
const indexPath = join(staticDir, "index.html");
const desktopPath = join(staticDir, "desktop.html");
const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM || process.env.TAURI_ENV_FAMILY);

if (!isTauri) {
  process.exit(0);
}

if (!existsSync(staticDir)) {
  console.error("[tauri-index] no static output — frontend pack did not run");
  process.exit(1);
}

function looksLikeDesktopShell(html) {
  return html.includes("potion-root") && /assets\/(?:desktop|index)-[^"' ]+\.js/.test(html) && !html.includes("/src/main.tsx");
}

if (existsSync(desktopPath)) {
  const html = readFileSync(desktopPath, "utf8");
  if (looksLikeDesktopShell(html)) {
    copyFileSync(desktopPath, indexPath);
    process.exit(0);
  }
}

const assetsDir = join(staticDir, "assets");
if (!existsSync(assetsDir)) {
  console.error("[tauri-index] no assets/ — Vite did not emit a desktop bundle");
  process.exit(1);
}

const files = readdirSync(assetsDir);
const js =
  files.find((f) => /^desktop-.*\.js$/.test(f)) ||
  files.find((f) => /^index-.*\.js$/.test(f));
const css =
  files.find((f) => /^desktop-.*\.css$/.test(f)) ||
  files.find((f) => /^styles-.*\.css$/.test(f)) ||
  files.find((f) => f.endsWith(".css"));
if (!js) {
  console.error("[tauri-index] no desktop-*.js in assets/");
  process.exit(1);
}

const html = `<!doctype html>
<html lang="en" class="antialiased dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover" />
    <title>Potion</title>
    <meta name="theme-color" content="#0a0b0a" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    ${css ? `<link rel="stylesheet" href="./assets/${css}" />` : ""}
    <script>
      (function () {
        try {
          var t = localStorage.getItem("potion-theme") === "light" ? "light" : "dark";
          var r = document.documentElement;
          r.classList.remove("light", "dark");
          r.classList.add(t);
          r.style.colorScheme = t;
        } catch (e) {
          document.documentElement.classList.add("dark");
        }
      })();
    </script>
  </head>
  <body class="bg-background text-foreground">
    <div id="potion-root">Opening Potion…</div>
    <script type="module" src="./assets/${js}"></script>
  </body>
</html>
`;

writeFileSync(indexPath, html);
