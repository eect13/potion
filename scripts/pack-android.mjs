#!/usr/bin/env node
/**
 * Real Android APK via Tauri 2 (same WebView stack as the desktop app).
 * Not a PWA, TWA, or PWABuilder wrapper.
 *
 *   node scripts/pack-android.mjs
 *
 * Needs JDK 17 (not Studio JBR 25), Android SDK + NDK, and Rust.
 * On Windows without Developer Mode, Tauri’s jniLibs symlink fails — this
 * script falls back to copying the .so + Vite assets and Gradle assemble
 * with -x rustBuild*.
 *
 * Rust lib is built with `cargo build --release --features custom-protocol`
 * (NDK clang linker env). Without custom-protocol, Tauri bakes in
 * build.devUrl (127.0.0.1:8080) and the release APK shows a black screen.
 * android-studio-script is only a fallback (it often panics on the
 * missing Temp\\…-server-addr file on Windows).
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const OUT = join(ROOT, "deploy", "android");
const WIN = platform() === "win32";
const GEN = join(ROOT, "src-tauri", "gen", "android");
const STATIC = join(ROOT, ".vercel", "output", "static");
const LIB_SO = "libpotion_lib.so";
const SO_RELEASE = join(ROOT, "src-tauri", "target", "aarch64-linux-android", "release", LIB_SO);
const JNI_DIR = join(GEN, "app", "src", "main", "jniLibs", "arm64-v8a");
const ASSETS = join(GEN, "app", "src", "main", "assets");
const APK_DIR = join(GEN, "app", "build", "outputs", "apk", "arm64", "release");

function fail(msg, extra) {
  console.error(`\n✗ ${msg}`);
  if (extra) console.error(extra);
  process.exit(1);
}

function winQuote(cmd) {
  if (!WIN) return cmd;
  if (!/[ \t]/.test(cmd)) return cmd;
  if (cmd.startsWith('"') && cmd.endsWith('"')) return cmd;
  return `"${cmd}"`;
}

function run(cmd, args, env = process.env, opts = {}) {
  // On Windows, shell:true + an unquoted path with spaces (e.g. C:\Program Files\nodejs\node.exe)
  // becomes `'C:\Program' is not recognized`. Only use shell for .bat/.cmd unless overridden.
  const bat = WIN && /\.(bat|cmd)$/i.test(String(cmd).replace(/^"|"$/g, ""));
  const useShell = opts.shell ?? bat;
  const r = spawnSync(useShell ? winQuote(cmd) : cmd, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: opts.stdio ?? "inherit",
    shell: useShell,
    env,
    encoding: opts.encoding,
    windowsHide: true,
  });
  return r.status ?? 1;
}

function runCapture(cmd, args, env = process.env) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env,
    encoding: "utf8",
    windowsHide: true,
    // cargo metadata for Tauri+plugins is multi-MB; Node default ~1MB maxBuffer fails the APK helpers.
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: r.status ?? 1,
    out: r.stdout || "",
    err: r.stderr || "",
    combined: `${r.stdout || ""}${r.stderr || ""}`,
  };
}

function which(cmd) {
  const r = spawnSync(WIN ? "where" : "which", [cmd], { stdio: "ignore", shell: WIN });
  return r.status === 0;
}

function prependCargoBin() {
  const bin = join(homedir(), ".cargo", "bin");
  if (!existsSync(bin)) return;
  const key =
    WIN ? Object.keys(process.env).find((k) => k.toLowerCase() === "path") || "Path" : "PATH";
  const cur = process.env[key] || process.env.PATH || "";
  const needle = WIN ? bin.toLowerCase() : bin;
  const hay = WIN ? cur.toLowerCase() : cur;
  if (hay.includes(needle)) return;
  const next = `${bin}${WIN ? ";" : ":"}${cur}`;
  process.env[key] = next;
  process.env.PATH = next;
}

function npmCmd() {
  const local = join(dirname(process.execPath), WIN ? "npm.cmd" : "npm");
  if (existsSync(local)) return local;
  return WIN ? "npm.cmd" : "npm";
}

function rustupBin() {
  const p = join(homedir(), ".cargo", "bin", WIN ? "rustup.exe" : "rustup");
  return existsSync(p) ? p : "rustup";
}

function ensureRust() {
  prependCargoBin();
  if (which("rustc") && which("cargo")) return;
  console.log("\nRust is missing — installing (one time)…");
  if (WIN) {
    const winget = spawnSync(
      "winget",
      [
        "install",
        "-e",
        "--id",
        "Rustlang.Rustup",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ],
      { stdio: "inherit", shell: true },
    );
    if (winget.status !== 0) {
      fail(
        "Could not install Rust automatically.",
        "Open https://rustup.rs then re-run apk.bat.\nOr double-click desktop-setup.bat first.",
      );
    }
  } else {
    const sh = spawnSync(
      "sh",
      ["-c", "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"],
      { stdio: "inherit", env: process.env },
    );
    if (sh.status !== 0) fail("Could not install Rust automatically.", "Open https://rustup.rs then re-run.");
  }
  prependCargoBin();
  if (!which("rustc") || !which("cargo")) {
    fail(
      "Rust installed, but this window cannot see it yet.",
      "Close this window, open a new one, then double-click apk.bat again.",
    );
  }
}

function ensureAndroidRustTarget() {
  prependCargoBin();
  const rustup = rustupBin();
  const listed = runCapture(rustup, ["target", "list", "--installed"]);
  if (listed.out.includes("aarch64-linux-android")) {
    console.log("  Rust target aarch64-linux-android OK");
    return;
  }
  console.log("  Adding Rust target aarch64-linux-android (one time)…");
  if (run(rustup, ["target", "add", "aarch64-linux-android"]) !== 0) {
    fail("Could not add aarch64-linux-android.", "Run: rustup target add aarch64-linux-android");
  }
}

function javaMajor(javaHome) {
  const bin = join(javaHome, "bin", WIN ? "java.exe" : "java");
  if (!existsSync(bin)) return null;
  const { out, err } = runCapture(bin, ["-version"]);
  const m = `${out}${err}`.match(/version "(\d+)/);
  return m ? Number(m[1]) : null;
}

function isStudioJbr(p) {
  const n = p.replace(/\//g, "\\").toLowerCase();
  return n.includes("android studio") && n.includes("\\jbr");
}

function findJdk17() {
  const candidates = [];
  const push = (p) => {
    if (p && existsSync(p) && existsSync(join(p, "bin", WIN ? "java.exe" : "java"))) {
      candidates.push(p);
    }
  };

  if (process.env.JAVA_HOME) push(process.env.JAVA_HOME);

  if (WIN) {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    for (const base of [
      join(pf, "Microsoft"),
      join(pf, "Eclipse Adoptium"),
      join(pf, "Java"),
      join(pf, "Microsoft", "jdk-17*"),
      join(local, "Programs", "Eclipse Adoptium"),
      join(pf86, "Eclipse Adoptium"),
    ]) {
      if (base.includes("*")) continue;
      if (!existsSync(base)) continue;
      try {
        for (const name of readdirSync(base)) {
          if (/jdk-?17/i.test(name) || /^jdk-17/i.test(name)) push(join(base, name));
        }
      } catch {
        /* ignore */
      }
    }
    // Exact Microsoft OpenJDK layout used on Eric’s PC
    push(join(pf, "Microsoft", "jdk-17.0.20.101-hotspot"));
    // Temurin-style
    for (const base of [join(pf, "Eclipse Adoptium"), join(local, "Programs", "Eclipse Adoptium")]) {
      if (!existsSync(base)) continue;
      try {
        for (const name of readdirSync(base)) {
          if (/jdk-17|temurin-17/i.test(name)) push(join(base, name));
        }
      } catch {
        /* ignore */
      }
    }
  } else {
    for (const p of [
      "/usr/lib/jvm/java-17-openjdk-amd64",
      "/usr/lib/jvm/java-17-openjdk",
      "/Library/Java/JavaVirtualMachines",
    ]) {
      if (p.endsWith("JavaVirtualMachines") && existsSync(p)) {
        for (const name of readdirSync(p)) {
          if (/17/.test(name)) push(join(p, name, "Contents", "Home"));
        }
      } else push(p);
    }
  }

  const seen = new Set();
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isStudioJbr(c)) continue;
    const major = javaMajor(c);
    if (major === 17) return c;
  }
  return null;
}

function findSdk() {
  const env = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (env && existsSync(env)) return env;
  const home = homedir();
  const candidates = WIN
    ? [
        join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "Android", "Sdk"),
        join(home, "AppData", "Local", "Android", "Sdk"),
        "C:\\Android\\Sdk",
      ]
    : [join(home, "Android", "Sdk"), join(home, "Library", "Android", "sdk"), "/usr/lib/android-sdk"];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function findNdk(sdk) {
  if (process.env.NDK_HOME && existsSync(process.env.NDK_HOME)) return process.env.NDK_HOME;
  const ndkRoot = join(sdk, "ndk");
  if (existsSync(ndkRoot)) {
    const versions = readdirSync(ndkRoot)
      .filter((n) => {
        try {
          return statSync(join(ndkRoot, n)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse();
    // Prefer known-good 30.x if present, else newest
    const preferred = versions.find((v) => v.startsWith("30."));
    if (preferred) return join(ndkRoot, preferred);
    if (versions[0]) return join(ndkRoot, versions[0]);
  }
  const bundled = join(sdk, "ndk-bundle");
  return existsSync(bundled) ? bundled : null;
}

function findBuildTools(sdk) {
  const root = join(sdk, "build-tools");
  if (!existsSync(root)) return null;
  const versions = readdirSync(root)
    .filter((n) => {
      try {
        return statSync(join(root, n)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .reverse();
  return versions[0] ? join(root, versions[0]) : null;
}

function windowsSymlinksOk() {
  if (!WIN) return true;
  const dir = join(tmpdir(), `fm-symlink-test-${process.pid}`);
  const target = join(dir, "t.txt");
  const link = join(dir, "l.txt");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, "x");
    symlinkSync(target, link);
    return true;
  } catch {
    return false;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function ensureTauriNpmScript() {
  const pkgPath = join(ROOT, "package.json");
  if (!existsSync(pkgPath)) fail("package.json missing at repo root.");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.scripts = pkg.scripts || {};
  if (pkg.scripts.tauri === "tauri") return false;
  pkg.scripts.tauri = "tauri";
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log('  Added "tauri": "tauri" to package.json (required by Gradle rustBuild).');
  return true;
}


function ensureNpmDeps() {
  const cliJs = join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");
  const cliBin = join(ROOT, "node_modules", ".bin", WIN ? "tauri.cmd" : "tauri");
  if (existsSync(cliJs) || existsSync(cliBin)) return;
  console.log("\nnode_modules/@tauri-apps/cli missing (common after sync without node_modules)…");
  console.log("Running npm install --legacy-peer-deps…");
  const status = run(npmCmd(), ["install", "--legacy-peer-deps"], process.env, { shell: WIN });
  if (status !== 0 || !(existsSync(cliJs) || existsSync(cliBin))) {
    fail("npm install failed or @tauri-apps/cli still missing.", "Run npm install at the repo root, then retry.");
  }
  console.log("  npm install OK.");
}

function androidIdentifier() {
  try {
    const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
    const id = String(conf.identifier || "").trim();
    if (id) return id;
  } catch {
    /* fall through */
  }
  return "app.potion.desktop";
}

function androidLibName() {
  try {
    const cargo = readFileSync(join(ROOT, "src-tauri", "Cargo.toml"), "utf8");
    const m = cargo.match(/\[lib\][\s\S]*?name\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  } catch {
    /* fall through */
  }
  return "potion_lib";
}

/** Kotlin-safe package: app.foo.bar -> backtick-escaped segments (matches tauri-cli). */
function escapeKotlinPackage(id) {
  return id
    .split(".")
    .filter(Boolean)
    .map((seg) => "`" + seg + "`")
    .join(".");
}

function androidKotlinOutDir() {
  const idPath = androidIdentifier().replace(/\./g, "/");
  return join(GEN, "app", "src", "main", "java", idPath, "generated");
}

/**
 * tauri android init does NOT write these gitignored files — tauri android build does.
 * Our Windows cargo/copy/Gradle path never runs the CLI build, so generate them from
 * cargo metadata (same approach as Tauri CI workarounds).
 */
function ensureTauriGradleHelpers() {
  const settingsPath = join(GEN, "tauri.settings.gradle");
  const buildPath = join(GEN, "app", "tauri.build.gradle.kts");
  if (existsSync(settingsPath) && existsSync(buildPath)) {
    console.log("  Tauri Gradle helpers present.");
    return;
  }
  console.log("  Generating tauri.settings.gradle + app/tauri.build.gradle.kts from cargo metadata…");
  const meta = runCapture("cargo", [
    "metadata",
    "--format-version",
    "1",
    "--manifest-path",
    join(ROOT, "src-tauri", "Cargo.toml"),
  ]);
  if (meta.status !== 0) {
    fail("cargo metadata failed while generating Android Gradle helpers.", meta.err || meta.combined);
  }
  let parsed;
  try {
    parsed = JSON.parse(meta.out);
  } catch (e) {
    fail("cargo metadata JSON parse failed.", String(e));
  }
  let tauriAndroid = null;
  /** @type {Record<string, string>} */
  const plugins = {};
  for (const pkg of parsed.packages || []) {
    const name = pkg.name;
    const pkgDir = dirname(pkg.manifest_path);
    if (name === "tauri") {
      const android = join(pkgDir, "mobile", "android");
      if (existsSync(android)) tauriAndroid = android;
    } else if (typeof name === "string" && name.startsWith("tauri-plugin-")) {
      const android = join(pkgDir, "android");
      if (existsSync(android)) plugins[name] = android;
    }
  }
  if (!tauriAndroid) {
    fail(
      "tauri crate mobile/android not found in cargo metadata.",
      "Run a cargo build once so the registry is populated, then retry.",
    );
  }
  const gpath = (p) => p.replace(/\\/g, "/");
  const ordered = Object.keys(plugins).sort();
  const settingsLines = [
    "// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.",
    "include ':tauri-android'",
    `project(':tauri-android').projectDir = new File("${gpath(tauriAndroid)}")`,
  ];
  for (const name of ordered) {
    settingsLines.push(`include ':${name}'`);
    settingsLines.push(`project(':${name}').projectDir = new File("${gpath(plugins[name])}")`);
  }
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, settingsLines.join("\n") + "\n");
  const buildLines = [
    "// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.",
    "val implementation by configurations",
    "dependencies {",
    '    implementation("androidx.lifecycle:lifecycle-process:2.10.0")',
    '    implementation(project(":tauri-android"))',
  ];
  for (const name of ordered) {
    buildLines.push(`    implementation(project(":${name}"))`);
  }
  buildLines.push("}");
  mkdirSync(dirname(buildPath), { recursive: true });
  writeFileSync(buildPath, buildLines.join("\n"));
  console.log(`  Wrote ${settingsPath}`);
  console.log(`  Wrote ${buildPath}`);
}


/**
 * wry build.rs honors rerun-if-env-changed for WRY_ANDROID_*; tauri's build.rs does not,
 * so a cached tauri build can skip TauriActivity.kt even when the env is set now.
 * Write missing codegen files from the crate templates (same substitutions as build.rs).
 */
function ensureTauriKotlinFromTemplates() {
  const outDir = androidKotlinOutDir();
  mkdirSync(outDir, { recursive: true });
  const meta = runCapture("cargo", [
    "metadata",
    "--format-version",
    "1",
    "--manifest-path",
    join(ROOT, "src-tauri", "Cargo.toml"),
  ]);
  if (meta.status !== 0) return;
  let parsed;
  try {
    parsed = JSON.parse(meta.out);
  } catch {
    return;
  }
  const pkgName = escapeKotlinPackage(androidIdentifier());
  const libName = androidLibName();
  for (const pkg of parsed.packages || []) {
    if (pkg.name !== "tauri") continue;
    const tplDir = join(dirname(pkg.manifest_path), "mobile", "android-codegen");
    if (!existsSync(tplDir)) continue;
    for (const name of readdirSync(tplDir)) {
      if (!name.endsWith(".kt")) continue;
      const dest = join(outDir, name);
      if (existsSync(dest)) continue;
      let content = readFileSync(join(tplDir, name), "utf8");
      content = content.replaceAll("{{package}}", pkgName).replaceAll("{{library}}", libName);
      writeFileSync(dest, content);
      console.log(`  Wrote ${name} from tauri android-codegen template`);
    }
  }
}

function ensureAndroidProject(env) {
  const gradlew = join(GEN, WIN ? "gradlew.bat" : "gradlew");
  const settings = join(GEN, "settings.gradle");
  const needInit = !existsSync(GEN) || !existsSync(gradlew) || !existsSync(settings);
  if (needInit) {
    if (existsSync(GEN) && !existsSync(gradlew)) {
      console.log("\nIncomplete gen/android — removing and re-running tauri android init…");
      rmSync(GEN, { recursive: true, force: true });
    } else {
      console.log("\nInitializing the Android project (first time)…");
    }
    const npx = WIN ? "npx.cmd" : "npx";
    if (run(npx, ["tauri", "android", "init", "--ci"], env) !== 0) {
      fail("tauri android init failed. Open Android Studio once so the SDK/NDK finish installing.");
    }
  }
  ensureTauriGradleHelpers();
}

function pinGradleJavaHome(jdk) {
  const props = join(GEN, "gradle.properties");
  if (!existsSync(props)) return;
  let text = readFileSync(props, "utf8");
  const escaped = jdk.replace(/\\/g, "\\\\");
  const line = `org.gradle.java.home=${escaped}`;
  if (/^org\.gradle\.java\.home=.*/m.test(text)) {
    text = text.replace(/^org\.gradle\.java\.home=.*/m, line);
  } else {
    text = `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(props, text);
  console.log(`  Pinned org.gradle.java.home → ${jdk}`);
}

function walkApk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkApk(path, acc);
    else if (name.endsWith(".apk")) acc.push(path);
  }
  return acc;
}

function buildFrontend(env) {
  console.log("\nPacking Vite UI for Android assets…");
  const feEnv = {
    ...env,
    // Force vite.config.ts isTauriBuild → static SPA (not Nitro website).
    TAURI_ENV_PLATFORM: env.TAURI_ENV_PLATFORM || "android",
  };
  if (run(process.execPath, [join(ROOT, "scripts", "tauri-before-build.mjs")], feEnv) !== 0) {
    fail("Frontend (Vite) build failed.");
  }
  if (!existsSync(join(STATIC, "index.html"))) {
    fail("UI pack missing .vercel/output/static/index.html");
  }
}

function findAndroidClang(ndk) {
  const prebuilt = join(ndk, "toolchains", "llvm", "prebuilt");
  if (!existsSync(prebuilt)) return null;
  const hosts = readdirSync(prebuilt).filter((n) => {
    try {
      return statSync(join(prebuilt, n)).isDirectory();
    } catch {
      return false;
    }
  });
  // Prefer the host we are on
  const prefer = WIN
    ? hosts.filter((h) => /windows/i.test(h))
    : hosts.filter((h) => /linux/i.test(h));
  const host = prefer[0] || hosts[0];
  if (!host) return null;
  const bin = join(prebuilt, host, "bin");
  // API 24 matches bundle.android.minSdkVersion
  const candidates = WIN
    ? ["aarch64-linux-android24-clang.cmd", "aarch64-linux-android24-clang.exe", "clang.exe"]
    : ["aarch64-linux-android24-clang", "clang"];
  for (const name of candidates) {
    const p = join(bin, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function cargoEnvForAndroid(env, ndk) {
  const clang = findAndroidClang(ndk);
  const identifier = androidIdentifier();
  const libName = androidLibName();
  const kotlinOut = androidKotlinOutDir();
  mkdirSync(kotlinOut, { recursive: true });
  const next = {
    ...env,
    TAURI_ENV_PLATFORM: "android",
    TAURI_ENV_DEBUG: "false",
    // Ensure release context even if a prior `tauri android dev` left debug flags around
    CARGO_PROFILE_RELEASE_STRIP: env.CARGO_PROFILE_RELEASE_STRIP || "true",
    // Required so tauri/wry build.rs emit TauriActivity.kt + WryActivity.kt into gen/
    // (tauri android init does not create these; only CLI build / these env vars do).
    WRY_ANDROID_PACKAGE: escapeKotlinPackage(identifier),
    TAURI_ANDROID_PACKAGE_UNESCAPED: identifier,
    WRY_ANDROID_LIBRARY: libName,
    WRY_ANDROID_KOTLIN_FILES_OUT_DIR: kotlinOut,
    TAURI_ANDROID_PROJECT_PATH: GEN,
  };
  if (clang) {
    next.CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = clang;
    next.CC_aarch64_linux_android = clang;
    const binDir = dirname(clang);
    const arNames = WIN ? ["llvm-ar.exe", "llvm-ar.cmd", "llvm-ar"] : ["llvm-ar"];
    for (const name of arNames) {
      const ar = join(binDir, name);
      if (existsSync(ar)) {
        next.AR_aarch64_linux_android = ar;
        break;
      }
    }
    console.log(`  NDK clang  ${clang}`);
  } else {
    console.log("  NDK clang not found — cargo may still work if ~/.cargo/config.toml has a linker.");
  }
  console.log(`  Kotlin out ${kotlinOut}`);
  return next;
}

function buildRustArm64(env) {
  console.log("\nCompiling Rust lib for aarch64-linux-android (release, custom-protocol)…");
  const ndk = env.NDK_HOME || env.ANDROID_NDK_HOME;
  const cargoEnv = cargoEnvForAndroid(env, ndk);

  // Prefer direct cargo — android-studio-script often panics on Windows
  // (missing Temp\\…-server-addr) even after a successful rustc link.
  const cargoArgs = [
    "build",
    "--manifest-path",
    join(ROOT, "src-tauri", "Cargo.toml"),
    "--release",
    "--target",
    "aarch64-linux-android",
    "--features",
    "custom-protocol",
  ];
  let status = run("cargo", cargoArgs, cargoEnv);
  if (existsSync(SO_RELEASE)) {
    if (status !== 0) {
      console.log("  Rust .so is present (cargo reported a non-zero status — continuing).");
    } else {
      console.log("  Built via cargo --release --features custom-protocol");
    }
    ensureTauriKotlinFromTemplates();
    const tauriAct = join(androidKotlinOutDir(), "TauriActivity.kt");
    if (!existsSync(tauriAct)) {
      fail(
        "Rust .so built but TauriActivity.kt was not generated.",
        `Expected: ${tauriAct}\nWRY_ANDROID_* env must be set during cargo (packer bug).`,
      );
    }
    console.log(`  Kotlin activity ${basename(tauriAct)}`);
    return true;
  }

  console.log("  Direct cargo did not produce the .so — trying tauri android-studio-script…");
  const npx = WIN ? "npx.cmd" : "npx";
  status = run(
    npx,
    ["tauri", "android", "android-studio-script", "--release", "--target", "aarch64"],
    cargoEnv,
  );
  if (existsSync(SO_RELEASE)) {
    if (status !== 0) {
      console.log("  Rust .so is present (symlink/script step likely failed — continuing with copy fallback).");
    }
    return true;
  }
  fail(
    "Rust Android library was not produced.",
    `Expected: ${SO_RELEASE}\nFix NDK / Rust Android targets, then retry.\ncargo/android-studio-script exit: ${status}`,
  );
}

function copySoToJniLibs() {
  if (!existsSync(SO_RELEASE)) fail(`Missing ${SO_RELEASE}`);
  mkdirSync(JNI_DIR, { recursive: true });
  const dest = join(JNI_DIR, LIB_SO);
  try {
    if (existsSync(dest)) rmSync(dest, { force: true });
  } catch {
    try {
      unlinkSync(dest);
    } catch {
      /* ignore */
    }
  }
  copyFileSync(SO_RELEASE, dest);
  console.log(`  Copied ${LIB_SO} → jniLibs/arm64-v8a (file copy, not symlink)`);
}

function syncAssets() {
  if (!existsSync(join(STATIC, "index.html"))) {
    fail("Missing Vite output at .vercel/output/static — frontend pack did not run.");
  }
  mkdirSync(ASSETS, { recursive: true });
  for (const name of readdirSync(ASSETS)) {
    rmSync(join(ASSETS, name), { recursive: true, force: true });
  }
  for (const name of readdirSync(STATIC)) {
    cpSync(join(STATIC, name), join(ASSETS, name), { recursive: true });
  }
  console.log("  Synced Vite output → app/src/main/assets");
}

function gradleAssembleArm64(env) {
  const gradlew = join(GEN, WIN ? "gradlew.bat" : "gradlew");
  if (!existsSync(gradlew)) fail(`Missing ${gradlew} — run tauri android init first.`);
  console.log("\nGradle assembleArm64Release (-x rustBuild*; uses copied .so)…");
  const args = [
    "assembleArm64Release",
    "-x",
    "rustBuildArm64Release",
    "-x",
    "rustBuildUniversalRelease",
    "--no-daemon",
  ];
  const status = run(gradlew, args, env, { cwd: GEN, shell: WIN });
  if (status !== 0) {
    fail(
      "Gradle assembleArm64Release failed.",
      "Confirm JDK 17 is active and NDK is installed. See deploy/android/README.md",
    );
  }
}

function signApkIfNeeded(sdk, env) {
  const unsigned = join(APK_DIR, "app-arm64-release-unsigned.apk");
  const signed = join(APK_DIR, "app-arm64-release.apk");
  if (existsSync(signed) && !existsSync(unsigned)) return signed;
  if (existsSync(signed)) {
    // Prefer already-signed if newer/equal size path from a prior run
  }
  const input = existsSync(unsigned) ? unsigned : existsSync(signed) ? null : null;
  if (!input) {
    if (existsSync(signed)) return signed;
    return null;
  }

  const buildTools = findBuildTools(sdk);
  if (!buildTools) {
    console.log("  build-tools not found — leaving unsigned APK (install SDK build-tools to auto-sign).");
    return unsigned;
  }

  const keystore = join(homedir(), ".android", "debug.keystore");
  if (!existsSync(keystore)) {
    console.log(`  No debug.keystore at ${keystore} — leaving unsigned APK.`);
    return unsigned;
  }

  const zipalign = join(buildTools, WIN ? "zipalign.exe" : "zipalign");
  const apksigner = join(buildTools, WIN ? "apksigner.bat" : "apksigner");
  const aligned = join(APK_DIR, "app-arm64-release-aligned.apk");

  console.log("  Signing with debug.keystore…");
  if (existsSync(zipalign)) {
    run(zipalign, ["-f", "4", unsigned, aligned], env);
  } else {
    copyFileSync(unsigned, aligned);
  }
  const signStatus = run(
    apksigner,
    [
      "sign",
      "--ks",
      keystore,
      "--ks-pass",
      "pass:android",
      "--key-pass",
      "pass:android",
      "--ks-key-alias",
      "androiddebugkey",
      "--out",
      signed,
      aligned,
    ],
    env,
  );
  if (signStatus !== 0 || !existsSync(signed)) {
    console.log("  apksigner failed — deploying unsigned APK.");
    return unsigned;
  }
  return signed;
}

function copyApksToDeploy(sdk, env, preferSigned) {
  mkdirSync(OUT, { recursive: true });
  const found = walkApk(join(GEN, "app", "build", "outputs"));
  if (found.length === 0) fail("Build finished but no .apk was found under gen/android.");

  let primary = preferSigned;
  if (!primary || !existsSync(primary)) {
    primary =
      found.find((p) => /app-arm64-release\.apk$/i.test(p) && !/unsigned/i.test(p)) ||
      found.find((p) => /arm64.*release.*\.apk$/i.test(p)) ||
      found[0];
  }

  // Always refresh friendly name + versioned name from package.json
  const friendly = join(OUT, "potion-arm64-release.apk");
  if (primary && existsSync(primary)) {
    copyFileSync(primary, friendly);
    console.log(`  ${friendly}`);
    try {
      const ver = readPackageVersion();
      const versioned = join(OUT, `potion-v${ver}-arm64-release.apk`);
      copyFileSync(primary, versioned);
      console.log(`  ${versioned}`);
    } catch {
      /* ignore */
    }
  }

  for (const apk of found) {
    const dest = join(OUT, basename(apk));
    copyFileSync(apk, dest);
    console.log(`  ${dest}`);
  }

  // If we signed in fallback, ensure friendly points at signed
  if (preferSigned && existsSync(preferSigned)) {
    copyFileSync(preferSigned, friendly);
  }
}




function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const ver = String(pkg.version || "").trim();
  if (!/^\d+\.\d+\.\d+/.test(ver)) fail(`package.json version looks wrong: ${ver}`);
  return ver.split("-")[0];
}

/** Keep Android App info in sync with package.json (was stuck at 3.57.0). */
function syncAndroidVersionFromPackage() {
  const ver = readPackageVersion();
  const [maj, min, pat] = ver.split(".").map((n) => Number(n));
  const versionCode = maj * 1_000_000 + min * 1_000 + pat;
  const propsPath = join(GEN, "app", "tauri.properties");
  if (!existsSync(dirname(propsPath))) {
    console.log("  Skipping Android version sync (gen/android/app missing).");
    return;
  }
  const body =
    "// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.\n" +
    `tauri.android.versionName=${ver}\n` +
    `tauri.android.versionCode=${versionCode}\n`;
  writeFileSync(propsPath, body);
  console.log(`  Android versionName=${ver} versionCode=${versionCode} → app/tauri.properties`);
}

/**
 * enableEdgeToEdge draws the WebView under the status bar; CSS safe-area is often 0
 * on Tauri Android. Force decor to fit system windows so every screen (including
 * the phone menu sheet) clears the status bar automatically.
 */
function patchAndroidSystemBars() {
  const marker = "potion-system-bars-v4";
  const appSrc = join(GEN, "app", "src", "main");
  if (!existsSync(appSrc)) {
    console.log("  Skipping system-bars patch (gen/android missing).");
    return;
  }
  const roots = [join(appSrc, "java"), join(appSrc, "kotlin")].filter((d) => existsSync(d));
  /** @type {string[]} */
  const files = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(path);
      else if (/MainActivity\.(kt|java)$/.test(name)) files.push(path);
    }
  }
  for (const r of roots) walk(r);
  if (files.length === 0) {
    console.log("  Skipping system-bars patch (MainActivity not found).");
    return;
  }

  // Full MainActivity v4: edge-to-edge + single content padding (one status-bar gap).
  const body = `package app.potion.desktop

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // ${marker}
    enablePotionWebViewZoom()
    applyPotionSystemBarInsets()
  }

  private fun applyPotionSystemBarInsets() {
    // v4: draw edge-to-edge, then pad the content root ONCE with system bar insets.
    // Do not also setDecorFitsSystemWindows(true) — that stacked a second gap.
    try {
      WindowCompat.setDecorFitsSystemWindows(window, false)
      val content = findViewById<View>(android.R.id.content) ?: return
      ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
        v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
        WindowInsetsCompat.CONSUMED
      }
      ViewCompat.requestApplyInsets(content)
    } catch (_: Throwable) {
    }
  }

  // potion-webview-zoom
  private fun enablePotionWebViewZoom() {
    try {
      val webViews = ArrayList<WebView>()
      fun collect(v: View) {
        if (v is WebView) webViews.add(v)
        if (v is ViewGroup) {
          for (i in 0 until v.childCount) collect(v.getChildAt(i))
        }
      }
      window?.decorView?.let { collect(it) }
      for (wv in webViews) {
        wv.settings.setSupportZoom(true)
        wv.settings.builtInZoomControls = true
        wv.settings.displayZoomControls = false
      }
    } catch (_: Throwable) {
    }
  }
}
`

  for (const file of files) {
    // Detect package line from existing file in case package differs
    const existing = readFileSync(file, "utf8");
    const pkgMatch = existing.match(/^package\s+([\w.]+)/m);
    let out = body;
    if (pkgMatch && pkgMatch[1] !== "app.potion.desktop") {
      out = out.replace("package app.potion.desktop", `package ${pkgMatch[1]}`);
    }
    if (existing.includes(marker) && existing.includes("applyPotionSystemBarInsets")) {
      console.log(`  System bars v2 already patched: ${basename(file)}`);
      continue;
    }
    writeFileSync(file, out);
    console.log(`  System bars v2 (insets after super + WebView pad) → ${basename(file)}`);
  }
}

function enableAndroidWebViewZoom() {
  const appSrc = join(GEN, "app", "src", "main");
  if (!existsSync(appSrc)) {
    console.log("  Skipping WebView zoom patch (gen/android missing).");
    return;
  }
  const marker = "potion-webview-zoom";
  const roots = [join(appSrc, "java"), join(appSrc, "kotlin")].filter((d) => existsSync(d));
  /** @type {string[]} */
  const files = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(path);
      else if (/MainActivity\.(kt|java)$/.test(name)) files.push(path);
    }
  }
  for (const r of roots) walk(r);
  if (files.length === 0) {
    console.log(
      "  Skipping WebView zoom patch (MainActivity not found). See src-tauri/mobile/android/enable-webview-zoom.kt.snippet",
    );
    return;
  }
  const helperKt = `
  // ${marker}
  private fun enablePotionWebViewZoom() {
    try {
      val webViews = ArrayList<android.webkit.WebView>()
      fun collect(v: android.view.View) {
        if (v is android.webkit.WebView) webViews.add(v)
        if (v is android.view.ViewGroup) {
          for (i in 0 until v.childCount) collect(v.getChildAt(i))
        }
      }
      window?.decorView?.let { collect(it) }
      for (wv in webViews) {
        wv.settings.setSupportZoom(true)
        wv.settings.builtInZoomControls = true
        wv.settings.displayZoomControls = false
      }
    } catch (_: Throwable) {
    }
  }
`;
  for (const file of files) {
    let src = readFileSync(file, "utf8");
    if (src.includes(marker)) {
      console.log(`  WebView zoom already patched: ${basename(file)}`);
      continue;
    }
    if (!/fun onCreate\s*\(/.test(src)) {
      console.log(`  Could not locate onCreate in ${basename(file)}; see enable-webview-zoom.kt.snippet`);
      continue;
    }
    src = src.replace(/fun onCreate\s*\(([^)]*)\)\s*\{/, (m) => `${m}\n        enablePotionWebViewZoom()`);
    if (!src.includes("enablePotionWebViewZoom()")) {
      console.log(`  Failed to insert zoom call in ${basename(file)}`);
      continue;
    }
    const idx = src.lastIndexOf("}");
    if (idx === -1) continue;
    src = src.slice(0, idx) + helperKt + "\n" + src.slice(idx);
    writeFileSync(file, src);
    console.log(`  Patched WebView pinch zoom → ${basename(file)}`);
  }
}


function syncAndroidLauncherIcons() {
  const srcRoot = join(ROOT, "src-tauri", "icons", "android");
  const destRoot = join(GEN, "app", "src", "main", "res");
  if (!existsSync(srcRoot) || !existsSync(dirname(destRoot))) {
    console.log("  Skipping launcher icon sync (icons/android or gen/android missing).");
    return;
  }
  mkdirSync(destRoot, { recursive: true });
  // Copy mipmap-* folders + values/ic_launcher_background.xml
  for (const name of readdirSync(srcRoot)) {
    const from = join(srcRoot, name);
    const to = join(destRoot, name);
    let st;
    try {
      st = statSync(from);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      mkdirSync(to, { recursive: true });
      cpSync(from, to, { recursive: true });
    }
  }
  console.log("  Synced brand launcher icons → gen/android/.../res (mipmap-*)");
}

function fallbackAssemble(env, sdk) {
  console.log("\n── Windows / no-symlink fallback ──");
  console.log("Copy .so into jniLibs, sync assets, Gradle -x rustBuild (no Developer Mode needed).\n");
  buildFrontend(env);
  buildRustArm64(env);
  copySoToJniLibs();
  syncAssets();
  syncAndroidLauncherIcons();
  syncAndroidVersionFromPackage();
  enableAndroidWebViewZoom();
  patchAndroidSystemBars();
  gradleAssembleArm64(env);
  const signed = signApkIfNeeded(sdk, env);
  copyApksToDeploy(sdk, env, signed);
}

console.log("Potion — Android APK (Tauri, not a PWA)\n");

prependCargoBin();
if (!which("node")) fail("Node.js 22+ is required.", "Install from https://nodejs.org");
ensureRust();
ensureAndroidRustTarget();

const jdk = findJdk17();
if (!jdk) {
  fail(
    "JDK 17 not found (required).",
    [
      "Install Microsoft OpenJDK 17 or Eclipse Temurin 17, then re-run apk.bat.",
      "  https://learn.microsoft.com/en-us/java/openjdk/download",
      "",
      "Do NOT use Android Studio’s bundled JBR (often Java 25) — it breaks Gradle for this project.",
      "Typical path: C:\\Program Files\\Microsoft\\jdk-17.0.xx.x-hotspot",
    ].join("\n"),
  );
}

const sdk = findSdk();
if (!sdk) {
  fail(
    "Android SDK not found.",
    "Install Android Studio (SDK + NDK). Then run deploy\\android\\apk.bat again.\nhttps://developer.android.com/studio",
  );
}

const ndk = findNdk(sdk);
if (!ndk) {
  fail(
    "Android NDK not found under the SDK.",
    [
      `Looked in: ${join(sdk, "ndk")}`,
      "In Android Studio: Settings → Languages & Frameworks → Android SDK → SDK Tools → NDK.",
      "Then set NDK_HOME to that version folder (e.g. …\\Sdk\\ndk\\30.0.16138531).",
    ].join("\n"),
  );
}

const env = {
  ...process.env,
  JAVA_HOME: jdk,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  NDK_HOME: ndk,
  ANDROID_NDK_HOME: ndk,
  PATH: `${join(jdk, "bin")}${WIN ? ";" : ":"}${process.env.PATH || ""}`,
};

console.log(`  JAVA_HOME  ${jdk} (JDK ${javaMajor(jdk)})`);
console.log(`  SDK        ${sdk}`);
console.log(`  NDK        ${ndk}`);

ensureNpmDeps();
ensureTauriNpmScript();

const npx = WIN ? "npx.cmd" : "npx";

ensureAndroidProject(env);

pinGradleJavaHome(jdk);
syncAndroidLauncherIcons();
enableAndroidWebViewZoom();

if (process.argv.includes("--env-check")) {
  console.log("\nEnv check OK (no build).");
  console.log(WIN && !windowsSymlinksOk() ? "  Symlinks: blocked (copy fallback would run)" : "  Symlinks: OK");
  process.exit(0);
}

const symOk = windowsSymlinksOk();
// Solo-reliable path: cargo --release --features custom-protocol → copy .so →
// sync assets → Gradle -x rustBuild*. Avoids android-studio-script server-addr
// panics and ensures the lib never bakes in 127.0.0.1:8080.
const preferCargo = WIN || process.argv.includes("--cargo") || !symOk;
if (preferCargo) {
  if (WIN && !symOk) {
    console.log(
      "\n⚠  Windows cannot create symlinks (Developer Mode off, or policy blocks them).",
    );
    console.log("   Using cargo + copy + Gradle -x rustBuild (solo-reliable path).");
  } else {
    console.log("\nUsing cargo + copy + Gradle path (release lib with custom-protocol)…");
  }
  fallbackAssemble(env, sdk);
  console.log("\nSideload deploy\\android\\potion-arm64-release.apk (files stay on the device).");
  process.exit(0);
}

syncAndroidLauncherIcons();
syncAndroidVersionFromPackage();
enableAndroidWebViewZoom();
patchAndroidSystemBars();

console.log("\nBuilding release APK via tauri android build…");
const tauriStatus = run(npx, ["tauri", "android", "build", "--apk", "--ci"], env);
if (tauriStatus === 0) {
  const apks = walkApk(join(GEN, "app", "build", "outputs"));
  if (apks.length === 0) fail("Build finished but no .apk was found under gen/android.");
  mkdirSync(OUT, { recursive: true });
  const primary =
    apks.find((p) => /arm64.*release\.apk$/i.test(p) && !/unsigned/i.test(p)) || apks[0];
  copyFileSync(primary, join(OUT, "potion-arm64-release.apk"));
  for (const apk of apks) {
    const dest = join(OUT, basename(apk));
    copyFileSync(apk, dest);
    console.log(`  ${dest}`);
  }
  console.log(`  ${join(OUT, "potion-arm64-release.apk")}`);
  console.log("\nSideload that APK. Files stay on the phone (IndexedDB).");
  process.exit(0);
}

console.log("\n⚠  tauri android build failed — trying cargo/copy/Gradle fallback…");
fallbackAssemble(env, sdk);
console.log("\nSideload deploy\\android\\potion-arm64-release.apk (files stay on the device).");
