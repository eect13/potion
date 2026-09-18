#!/usr/bin/env node
/** Android mipmaps are written by raster-icons (SVG → HD PNG). */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const r = spawnSync(process.execPath, [join(import.meta.dirname, "raster-icons.mjs")], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
