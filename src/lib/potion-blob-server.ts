import { copyFile, mkdir, open as fsOpen, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(process.cwd(), ".data", "potion-blobs");
const KEEP_VERSIONS = 20;

function safeId(id: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Bad id");
  return id;
}

function filePath(userId: string, id: string, version: number) {
  return join(ROOT, safeId(userId), `${safeId(id)}.v${Number(version) || 0}`);
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
    const n = Number(name.slice(prefix.length));
    if (Number.isFinite(n) && n < min) await unlink(join(dir, name)).catch(() => undefined);
  }
}
