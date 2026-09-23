/** Stream large files to OPFS (or chunked IndexedDB). Never load a whole gigabyte into RAM. */

import { fromBase64, toBase64 } from "./potion-bytes.ts";

export { fromBase64, toBase64 };
export const SLICE = 1024 * 1024;
const KEEP_VERSIONS = 20;
const OPFS_DIR = "potion-blobs";
const PARTS_DB = "potion-parts";

function hex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fingerprint(source: Blob): Promise<string> {
  const parts: string[] = [];
  for (let offset = 0; offset < source.size; offset += SLICE) {
    const slice = source.slice(offset, Math.min(offset + SLICE, source.size));
    const digest = await crypto.subtle.digest("SHA-256", await slice.arrayBuffer());
    parts.push(hex(digest));
  }
  const joined = new TextEncoder().encode(parts.join("") + ":" + source.size);
  return hex(await crypto.subtle.digest("SHA-256", joined));
}

function blobName(nodeId: string, version: number) {
  return `${nodeId}.v${version}`;
}

async function opfsDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(OPFS_DIR, { create: true });
  } catch {
    return null;
  }
}

async function listOpfsNames(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  const it = dir as unknown as AsyncIterable<string | [string, FileSystemHandle] | FileSystemHandle>;
  try {
    for await (const entry of it) {
      if (typeof entry === "string") names.push(entry);
      else if (Array.isArray(entry)) names.push(entry[0]);
      else if (entry && typeof entry === "object" && "name" in entry) names.push(entry.name);
    }
  } catch {
    /* ignore */
  }
  return names;
}

export async function persistStorage() {
  try {
    await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}

export async function writeLocalBlob(nodeId: string, version: number, source: Blob, start = 0): Promise<void> {
  await persistStorage();
  const from = Math.max(0, Math.min(start, source.size));
  const dir = await opfsDir();
  if (dir) {
    const handle = await dir.getFileHandle(blobName(nodeId, version), { create: true });
    const writable = await handle.createWritable({ keepExistingData: from > 0 });
    try {
      if (from > 0) await writable.seek(from);
      const reader = source.slice(from).stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
      }
    } finally {
      await writable.close();
    }
    await pruneOpfs(dir, nodeId, version);
    return;
  }
  await writeIdbParts(nodeId, version, source, from);
}

export async function readLocalBlob(nodeId: string, version: number): Promise<Blob | null> {
  const dir = await opfsDir();
  if (dir) {
    try {
      const handle = await dir.getFileHandle(blobName(nodeId, version));
      return await handle.getFile();
    } catch {
      /* try idb */
    }
  }
  return readIdbParts(nodeId, version);
}

export async function copyLocalBlob(fromId: string, fromVer: number, toId: string, toVer: number) {
  const src = await readLocalBlob(fromId, fromVer);
  if (!src) return;
  await writeLocalBlob(toId, toVer, src);
}

export async function deleteLocalBlobs(nodeId: string) {
  const dir = await opfsDir();
  if (dir) {
    const drop: string[] = [];
    for (const name of await listOpfsNames(dir)) {
      if (name.startsWith(`${nodeId}.v`)) drop.push(name);
    }
    for (const name of drop) await dir.removeEntry(name).catch(() => undefined);
  }
  await deleteIdbParts(nodeId);
}

export async function listLocalVersions(nodeId: string): Promise<number[]> {
  const found = new Set<number>();
  const dir = await opfsDir();
  if (dir) {
    for (const name of await listOpfsNames(dir)) {
      if (!name.startsWith(`${nodeId}.v`)) continue;
      const n = Number(name.slice(nodeId.length + 2));
      if (Number.isFinite(n)) found.add(n);
    }
  }
  const idb = await listIdbVersions(nodeId);
  for (const n of idb) found.add(n);
  return [...found].sort((a, b) => b - a);
}

async function pruneOpfs(dir: FileSystemDirectoryHandle, nodeId: string, latest: number) {
  const min = latest - KEEP_VERSIONS + 1;
  const drop: string[] = [];
  for (const name of await listOpfsNames(dir)) {
    if (!name.startsWith(`${nodeId}.v`)) continue;
    const n = Number(name.slice(nodeId.length + 2));
    if (Number.isFinite(n) && n < min) drop.push(name);
  }
  for (const name of drop) await dir.removeEntry(name).catch(() => undefined);
}

function openParts(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PARTS_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("parts")) {
        const s = db.createObjectStore("parts", { keyPath: "key" });
        s.createIndex("node", "nodeId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function writeIdbParts(nodeId: string, version: number, source: Blob, start = 0) {
  const db = await openParts();
  let index = Math.floor(Math.max(0, start) / SLICE);
  for (let offset = index * SLICE; offset < source.size; offset += SLICE) {
    const slice = source.slice(offset, Math.min(offset + SLICE, source.size));
    const bytes = await slice.arrayBuffer();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("parts", "readwrite");
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.objectStore("parts").put({
        key: `${nodeId}:${version}:${index}`,
        nodeId,
        version,
        index,
        bytes,
      });
    });
    index += 1;
  }
  db.close();
  await pruneIdb(nodeId, version);
}

async function pruneIdb(nodeId: string, latest: number) {
  const min = latest - KEEP_VERSIONS + 1;
  const db = await openParts();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("parts", "readwrite");
    const store = t.objectStore("parts");
    const req = store.index("node").getAll(nodeId);
    req.onsuccess = () => {
      for (const r of req.result as Array<{ key: string; version: number }>) {
        if (r.version < min) store.delete(r.key);
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  db.close();
}

async function readIdbParts(nodeId: string, version: number): Promise<Blob | null> {
  const db = await openParts();
  const rows = await new Promise<Array<{ index: number; bytes: ArrayBuffer }>>((resolve, reject) => {
    const t = db.transaction("parts", "readonly");
    const req = t.objectStore("parts").index("node").getAll(nodeId);
    req.onsuccess = () => {
      const all = (req.result as Array<{ version: number; index: number; bytes: ArrayBuffer }>).filter(
        (r) => r.version === version,
      );
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!rows.length) return null;
  rows.sort((a, b) => a.index - b.index);
  return new Blob(rows.map((r) => r.bytes));
}

async function listIdbVersions(nodeId: string): Promise<number[]> {
  const db = await openParts();
  const vers = new Set<number>();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("parts", "readonly");
    const req = t.objectStore("parts").index("node").getAll(nodeId);
    req.onsuccess = () => {
      for (const r of req.result as Array<{ version: number }>) vers.add(r.version);
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  return [...vers];
}

async function deleteIdbParts(nodeId: string) {
  const db = await openParts();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("parts", "readwrite");
    const store = t.objectStore("parts");
    const req = store.index("node").getAllKeys(nodeId);
    req.onsuccess = () => {
      for (const key of req.result) store.delete(key);
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  db.close();
}

export async function deviceRoom() {
  try {
    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota ?? 0;
    const usage = estimate.usage ?? 0;
    return { usage, quota, free: Math.max(0, quota - usage) };
  } catch {
    return { usage: 0, quota: 0, free: Number.POSITIVE_INFINITY };
  }
}

/** Refuse only when the browser reports the write will not fit. No size cap. */
export async function assertRoom(bytes: number) {
  if (bytes <= 0) return;
  const room = await deviceRoom();
  if (room.quota > 0 && bytes > room.free) throw new Error("Not enough space on this device");
}
