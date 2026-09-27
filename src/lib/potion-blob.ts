/** Stream large files to OPFS (or chunked IndexedDB). Never load a whole gigabyte into RAM. */

import { fromBase64, toBase64 } from "./potion-bytes.ts";
import { fingerprint, LEAF } from "./potion-merkle.ts";

export { fromBase64, toBase64, fingerprint };
export const SLICE = LEAF;
const KEEP_VERSIONS = 20;
const OPFS_DIR = "potion-blobs";
const PARTS_DB = "potion-parts";

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

export function spaceError(err: unknown): Error {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return new Error("Not enough space on this device");
  }
  if (err instanceof Error) return err;
  return new Error("Save failed");
}

export async function writeLocalBlob(nodeId: string, version: number, source: Blob, start = 0): Promise<void> {
  try {
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
  } catch (err) {
    throw spaceError(err);
  }
}

/** Write one slice at a file offset. Does not prune. Caller checks the final size. */
export async function writeLocalSlice(nodeId: string, version: number, bytes: Uint8Array, offset: number) {
  try {
    await persistStorage();
    const dir = await opfsDir();
    if (dir) {
      const handle = await dir.getFileHandle(blobName(nodeId, version), { create: true });
      const writable = await handle.createWritable({ keepExistingData: offset > 0 });
      try {
        if (offset > 0) await writable.seek(offset);
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        await writable.write(copy);
      } finally {
        await writable.close();
      }
      return;
    }
    const db = await openParts();
    const index = Math.floor(offset / SLICE);
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("parts", "readwrite");
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.objectStore("parts").put({
        key: `${nodeId}:${version}:${index}`,
        nodeId,
        version,
        index,
        bytes: copy,
      });
    });
    db.close();
  } catch (err) {
    throw spaceError(err);
  }
}

export async function pruneLocal(nodeId: string, latest: number) {
  const dir = await opfsDir();
  if (dir) await pruneOpfs(dir, nodeId, latest);
  await pruneIdb(nodeId, latest);
}

export async function deleteLocalVersion(nodeId: string, version: number) {
  const dir = await opfsDir();
  if (dir) await dir.removeEntry(blobName(nodeId, version)).catch(() => undefined);
  const db = await openParts();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("parts", "readwrite");
    const store = t.objectStore("parts");
    const req = store.index("node").getAll(nodeId);
    req.onsuccess = () => {
      for (const row of req.result as Array<{ key: string; version: number }>) {
        if (row.version === version) store.delete(row.key);
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  db.close();
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
      if (!name.startsWith(`${nodeId}.v`) || name.endsWith(".leaves")) continue;
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
    const n = Number.parseInt(name.slice(nodeId.length + 2), 10);
    if (Number.isFinite(n) && n < min) drop.push(name);
  }
  for (const name of drop) await dir.removeEntry(name).catch(() => undefined);
}

function openParts(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PARTS_DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("parts")) {
        const s = db.createObjectStore("parts", { keyPath: "key" });
        s.createIndex("node", "nodeId");
      }
      if (!db.objectStoreNames.contains("leaves")) {
        db.createObjectStore("leaves", { keyPath: "key" });
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

export async function saveLeafList(nodeId: string, version: number, leaves: string[]) {
  const key = `${nodeId}:${version}`;
  try {
    const dir = await opfsDir();
    if (dir) {
      const handle = await dir.getFileHandle(`${blobName(nodeId, version)}.leaves`, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(JSON.stringify(leaves));
      } finally {
        await writable.close();
      }
      return;
    }
  } catch {
    /* IndexedDB */
  }
  const db = await openParts();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("leaves", "readwrite");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.objectStore("leaves").put({ key, leaves });
  });
  db.close();
}

export async function loadLeafList(nodeId: string, version: number): Promise<string[] | null> {
  try {
    const dir = await opfsDir();
    if (dir) {
      const handle = await dir.getFileHandle(`${blobName(nodeId, version)}.leaves`);
      const text = await (await handle.getFile()).text();
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed as string[];
    }
  } catch {
    /* fall through */
  }
  try {
    const db = await openParts();
    const row = await new Promise<{ leaves?: string[] } | undefined>((resolve, reject) => {
      const t = db.transaction("leaves", "readonly");
      const req = t.objectStore("leaves").get(`${nodeId}:${version}`);
      req.onsuccess = () => resolve(req.result as { leaves?: string[] } | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return row?.leaves ?? null;
  } catch {
    return null;
  }
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
