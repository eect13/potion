import { copyFile, mkdir, open as fsOpen, readdir, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { LEAF, merkleRoot, sha256 } from "./potion-merkle.ts";

const ROOT = join(process.cwd(), ".data", "potion-blobs");
const KEEP_VERSIONS = 20;

function safeId(id: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Bad id");
  return id;
}

function filePath(userId: string, id: string, version: number) {
  return join(ROOT, safeId(userId), `${safeId(id)}.v${Number(version) || 0}`);
}

export function blobFilePath(userId: string, id: string, version: number) {
  return filePath(userId, id, version);
}

/** Refuse only when the disk cannot hold the file. No size cap. */
export async function assertDisk(bytes: number) {
  if (bytes <= 0) return;
  const dir = process.cwd();
  const s = await statfs(dir);
  const free = Number(s.bavail) * Number(s.bsize);
  if (Number.isFinite(free) && bytes > free) throw new Error("Not enough space on the server");
}

export async function writeChunk(userId: string, id: string, version: number, offset: number, bytes: Uint8Array) {
  const dir = join(ROOT, safeId(userId));
  await mkdir(dir, { recursive: true });
  const fh = await fsOpen(filePath(userId, id, version), "a+");
  try {
    await fh.write(bytes, 0, bytes.byteLength, offset);
  } finally {
    await fh.close();
  }
  return bytes.byteLength;
}

export async function readChunk(userId: string, id: string, version: number, offset: number, length: number) {
  const path = filePath(userId, id, version);
  try {
    const fh = await fsOpen(path, "r");
    try {
      const buf = Buffer.alloc(Math.max(0, length));
      const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  } catch {
    return Buffer.alloc(0);
  }
}

export async function blobSize(userId: string, id: string, version: number) {
  try {
    const s = await stat(filePath(userId, id, version));
    return s.size;
  } catch {
    return 0;
  }
}

export async function copyBlob(userId: string, fromId: string, fromVer: number, toId: string, toVer: number) {
  const dir = join(ROOT, safeId(userId));
  await mkdir(dir, { recursive: true });
  try {
    await copyFile(filePath(userId, fromId, fromVer), filePath(userId, toId, toVer));
  } catch {
    /* source missing */
  }
}

export async function deleteBlobs(userId: string, id: string) {
  const dir = join(ROOT, safeId(userId));
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const prefix = `${safeId(id)}.v`;
  for (const name of names) {
    if (name.startsWith(prefix)) await unlink(join(dir, name)).catch(() => undefined);
  }
}

export async function pruneBlobs(userId: string, id: string, latest: number) {
  const dir = join(ROOT, safeId(userId));
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const prefix = `${safeId(id)}.v`;
  const min = latest - KEEP_VERSIONS + 1;
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const n = Number.parseInt(name.slice(prefix.length), 10);
    if (Number.isFinite(n) && n < min) await unlink(join(dir, name)).catch(() => undefined);
  }
}

/** Same root the browser computes, read one leaf at a time. */
export async function digestFile(path: string): Promise<{ root: string; leaves: string[] }> {
  let fh: Awaited<ReturnType<typeof fsOpen>> | null = null;
  try {
    fh = await fsOpen(path, "r");
  } catch {
    return { root: await merkleRoot([], 0), leaves: [] };
  }
  const leaves: string[] = [];
  const buf = Buffer.alloc(LEAF);
  let size = 0;
  try {
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, LEAF, size);
      if (!bytesRead) break;
      const copy = new Uint8Array(bytesRead);
      copy.set(buf.subarray(0, bytesRead));
      leaves.push(await sha256(copy));
      size += bytesRead;
      if (bytesRead < LEAF) break;
    }
  } finally {
    await fh.close();
  }
  return { root: await merkleRoot(leaves, size), leaves };
}

export async function fingerprintFile(path: string): Promise<string> {
  return (await digestFile(path)).root;
}

function leavesPath(userId: string, id: string, version: number) {
  return `${filePath(userId, id, version)}.leaves`;
}

export async function saveLeaves(userId: string, id: string, version: number, leaves: string[]) {
  const dir = join(ROOT, safeId(userId));
  await mkdir(dir, { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(leavesPath(userId, id, version), JSON.stringify(leaves));
}

export async function readLeaves(userId: string, id: string, version: number): Promise<string[] | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(leavesPath(userId, id, version), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== "string")) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

export async function ensureLeaves(userId: string, id: string, version: number): Promise<string[] | null> {
  const cached = await readLeaves(userId, id, version);
  if (cached) return cached;
  try {
    await stat(filePath(userId, id, version));
  } catch {
    return null;
  }
  const dig = await digestFile(filePath(userId, id, version));
  await saveLeaves(userId, id, version, dig.leaves);
  return dig.leaves;
}

/** Copy previous-version slices the tree says are unchanged. */
export async function copyCleanLeaves(userId: string, id: string, version: number, size: number, dirty: number[]) {
  if (version <= 1 || size <= 0) return false;
  const expect = Math.ceil(size / LEAF);
  const skip = new Set(dirty.filter((n) => n >= 0 && n < expect));
  const dir = join(ROOT, safeId(userId));
  await mkdir(dir, { recursive: true });
  let src: Awaited<ReturnType<typeof fsOpen>> | null = null;
  try {
    src = await fsOpen(filePath(userId, id, version - 1), "r");
  } catch {
    return false;
  }
  const dest = await fsOpen(filePath(userId, id, version), "a+");
  await dest.truncate(size);
  try {
    const buf = Buffer.alloc(LEAF);
    for (let i = 0; i < expect; i++) {
      if (skip.has(i)) continue;
      const offset = i * LEAF;
      const length = Math.min(LEAF, size - offset);
      const { bytesRead } = await src.read(buf, 0, length, offset);
      if (bytesRead !== length) continue;
      const copy = Buffer.from(buf.subarray(0, bytesRead));
      await dest.write(copy, 0, copy.byteLength, offset);
    }
  } finally {
    await dest.close();
    await src.close();
  }
  return true;
}

/** Copy 1 MB leaves that still match the previous version. Return offsets still needed. */
export async function seedLeaves(userId: string, id: string, version: number, leaves: string[], size: number) {
  const expect = size === 0 ? 0 : Math.ceil(size / LEAF);
  if (leaves.length !== expect) throw new Error("Leaf list did not match");
  const missing: number[] = [];
  if (size === 0) return missing;
  if (version <= 1) {
    for (let i = 0; i < leaves.length; i++) missing.push(i * LEAF);
    return missing;
  }
  const dir = join(ROOT, safeId(userId));
  await mkdir(dir, { recursive: true });
  let src: Awaited<ReturnType<typeof fsOpen>> | null = null;
  try {
    src = await fsOpen(filePath(userId, id, version - 1), "r");
  } catch {
    src = null;
  }
  const dest = await fsOpen(filePath(userId, id, version), "a+");
  await dest.truncate(size);
  try {
    const buf = Buffer.alloc(LEAF);
    for (let i = 0; i < leaves.length; i++) {
      const offset = i * LEAF;
      const length = Math.min(LEAF, size - offset);
      let match = false;
      if (src) {
        const { bytesRead } = await src.read(buf, 0, length, offset);
        if (bytesRead === length) {
          const copy = Buffer.from(buf.subarray(0, bytesRead));
          if ((await sha256(copy)) === leaves[i]) {
            await dest.write(copy, 0, copy.byteLength, offset);
            match = true;
          }
        }
      }
      if (!match) missing.push(offset);
    }
  } finally {
    await dest.close();
    await src?.close();
  }
  return missing;
}

export async function removeVersion(userId: string, id: string, version: number) {
  await unlink(filePath(userId, id, version)).catch(() => undefined);
  await unlink(`${filePath(userId, id, version)}.leaves`).catch(() => undefined);
}

/** Drop blob files whose version was never committed, once they are a day old. */
export async function sweepAhead(userId: string, committed: { id: string; version: number }[]) {
  const dir = join(ROOT, safeId(userId));
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const current = new Map(committed.map((c) => [c.id, c.version]));
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const name of names) {
    const match = /^([a-zA-Z0-9-]+)\.v(\d+)$/.exec(name);
    if (!match) continue;
    const known = current.get(match[1]);
    const ver = Number(match[2]);
    if (known != null && ver <= known) continue;
    try {
      const s = await stat(join(dir, name));
      if (s.mtimeMs > cutoff) continue;
      await unlink(join(dir, name));
    } catch {
      /* gone */
    }
  }
}
