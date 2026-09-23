import { assertRoom, copyLocalBlob, deleteLocalBlobs, fingerprint, listLocalVersions, readLocalBlob, writeLocalBlob } from "@/lib/potion-blob";
import { notifyPotion } from "@/lib/potion-watch";

const DB_NAME = "potion-drive";
const DB_VERSION = 2;

export type Kind = "file" | "folder";

export type PotionNode = {
  id: string;
  parentId: string | null;
  name: string;
  kind: Kind;
  mime: string | null;
  size: number;
  hash: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  synced: boolean;
};

export type PotionBlob = {
  id: string;
  nodeId: string;
  version: number;
  mime: string | null;
  bytes: ArrayBuffer;
};

export type PotionShare = {
  token: string;
  nodeId: string;
  password: string | null;
  expiresAt: number | null;
  createdAt: number;
};

export type PotionComment = {
  id: string;
  nodeId: string;
  body: string;
  author: string | null;
  createdAt: number;
};

export type PotionVersion = {
  version: number;
  size: number;
  updatedAt: number;
  current: boolean;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("nodes")) {
        const n = db.createObjectStore("nodes", { keyPath: "id" });
        n.createIndex("parent", "parentId");
        n.createIndex("updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("blobs")) {
        const b = db.createObjectStore("blobs", { keyPath: "id" });
        b.createIndex("node", "nodeId");
      }
      if (!db.objectStoreNames.contains("shares")) {
        db.createObjectStore("shares", { keyPath: "token" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("comments")) {
        const c = db.createObjectStore("comments", { keyPath: "id" });
        c.createIndex("node", "nodeId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    t.onerror = () => reject(t.error);
    Promise.resolve(run(t)).then(resolve, reject);
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function nid() {
  return crypto.randomUUID();
}

function guessMime(name: string) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return (
    {
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".csv": "text/csv",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".bmp": "image/bmp",
      ".avif": "image/avif",
      ".heic": "image/heic",
      ".heif": "image/heif",
      ".pdf": "application/pdf",
      ".zip": "application/zip",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".m4a": "audio/mp4",
      ".ogg": "audio/ogg",
      ".flac": "audio/flac",
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".webm": "video/webm",
      ".mkv": "video/x-matroska",
      ".avi": "video/x-msvideo",
      ".m4v": "video/mp4",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }[ext] || "application/octet-stream"
  );
}

export async function ensureSeeded() {
  const db = await open();
  const seeded = await tx(db, ["meta"], "readonly", (t) => req(t.objectStore("meta").get("seeded")));
  if (!seeded) {
    await tx(db, ["meta"], "readwrite", (t) => req(t.objectStore("meta").put({ key: "seeded", at: Date.now() })));
  }
  db.close();
}

function folder(parentId: string | null, name: string, now: number): PotionNode {
  return {
    id: nid(),
    parentId,
    name,
    kind: "folder",
    mime: null,
    size: 0,
    hash: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    synced: true,
  };
}

export async function listChildren(parentId: string | null, trash = false): Promise<PotionNode[]> {
  const db = await open();
  const all = await tx(db, ["nodes"], "readonly", (t) => req(t.objectStore("nodes").getAll()));
  db.close();
  const rows = all
    .filter((n) => (trash ? n.deletedAt : !n.deletedAt && n.parentId === parentId))
    .map((n) => ({ ...n, synced: n.synced !== false }));
  rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

export async function getNode(id: string): Promise<PotionNode | undefined> {
  const db = await open();
  const n = await tx(db, ["nodes"], "readonly", (t) => req(t.objectStore("nodes").get(id)));
  db.close();
  return n;
}

export async function pathOf(id: string | null): Promise<PotionNode[]> {
  if (!id) return [];
  const crumbs: PotionNode[] = [];
  let cur = await getNode(id);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    crumbs.unshift(cur);
    cur = cur.parentId ? await getNode(cur.parentId) : undefined;
  }
  return crumbs;
}

export async function mkdir(parentId: string | null, name: string) {
  const db = await open();
  const node = folder(parentId, name.trim() || "Untitled", Date.now());
  await tx(db, ["nodes"], "readwrite", (t) => req(t.objectStore("nodes").put(node)));
  db.close();
  notifyPotion("mkdir");
  return node;
}

export async function putFiles(parentId: string | null, files: File[]) {
  const now = Date.now();
  const existing = await listChildren(parentId);
  const byName = new Map(existing.filter((n) => n.kind === "file").map((n) => [n.name, n]));
  const written: PotionNode[] = [];
  for (const f of files) {
    await assertRoom(f.size);
    const mime = f.type || guessMime(f.name);
    const hash = await fingerprint(f);
    const found = byName.get(f.name);
    if (found && found.hash === hash) {
      const have = await readLocalBlob(found.id, found.version);
      if (have && have.size === f.size) {
        written.push(found);
        continue;
      }
      const start = have && have.size < f.size ? have.size : 0;
      found.size = f.size;
      found.mime = mime;
      found.updatedAt = now;
      const db = await open();
      await tx(db, ["nodes"], "readwrite", (t) => req(t.objectStore("nodes").put(found)));
      db.close();
      await writeLocalBlob(found.id, found.version, f, start);
      written.push(found);
      continue;
    }
    if (found) {
      const nextVer = found.version + 1;
      found.size = f.size;
      found.mime = mime;
      found.hash = hash;
      found.version = nextVer;
      found.updatedAt = now;
      const db = await open();
      await tx(db, ["nodes"], "readwrite", (t) => req(t.objectStore("nodes").put(found)));
      db.close();
      await writeLocalBlob(found.id, nextVer, f);
      written.push(found);
    } else {
      const id = nid();
      const node: PotionNode = {
        id,
        parentId,
        name: f.name,
        kind: "file",
        mime,
        size: f.size,
        hash,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        synced: true,
      };
      const db = await open();
      await tx(db, ["nodes"], "readwrite", (t) => req(t.objectStore("nodes").put(node)));
      db.close();
      await writeLocalBlob(id, 1, f);
      byName.set(f.name, node);
      written.push(node);
    }
  }
  notifyPotion("add");
  return written;
}

export async function rename(id: string, name: string) {
  const db = await open();
  const n = await tx(db, ["nodes"], "readwrite", async (t) => {
    const store = t.objectStore("nodes");
    const node = await req(store.get(id));
    if (!node) return null;
    node.name = name.trim() || node.name;
    node.updatedAt = Date.now();
    await req(store.put(node));
    return node;
  });
  db.close();
  notifyPotion("rename");
  return n;
}

async function allNodes(): Promise<PotionNode[]> {
  const db = await open();
  const all = await tx(db, ["nodes"], "readonly", (t) => req(t.objectStore("nodes").getAll()));
  db.close();
  return all;
}

export async function listAlive(): Promise<PotionNode[]> {
  const all = await allNodes();
  return all
    .filter((n) => !n.deletedAt)
    .map((n) => ({ ...n, synced: n.synced !== false }));
}

export async function uniqueName(parentId: string | null, name: string, skipId?: string) {
  const kids = await listChildren(parentId);
  const taken = new Set(kids.filter((k) => k.id !== skipId).map((k) => k.name));
  if (!taken.has(name)) return name;
  const copy = `Copy of ${name}`;
  if (!taken.has(copy)) return copy;
  let i = 2;
  while (taken.has(`Copy of ${name} (${i})`)) i += 1;
  return `Copy of ${name} (${i})`;
}

function isInside(all: PotionNode[], folderId: string, maybeDest: string | null) {
  if (!maybeDest) return false;
  if (maybeDest === folderId) return true;
  let cur = all.find((n) => n.id === maybeDest);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (cur.id === folderId) return true;
    cur = cur.parentId ? all.find((n) => n.id === cur!.parentId) : undefined;
  }
  return false;
}

export async function copyNode(id: string, destParentId: string | null) {
  const node = await getNode(id);
  if (!node || node.deletedAt) return null;
  const name = await uniqueName(destParentId, node.name);
  const now = Date.now();
  if (node.kind === "folder") {
    const made = await mkdir(destParentId, name);
    const kids = await listChildren(id);
    for (const k of kids) await copyNode(k.id, made.id);
    return made;
  }
  const newId = nid();
  const copy: PotionNode = {
    ...node,
    id: newId,
    parentId: destParentId,
    name,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    synced: node.synced !== false,
  };
  const db = await open();
  await tx(db, ["nodes"], "readwrite", (t) => req(t.objectStore("nodes").put(copy)));
  db.close();
  await copyLocalBlob(node.id, node.version, newId, 1);
  notifyPotion("copy");
  return copy;
}

export async function moveNode(id: string, destParentId: string | null) {
  const all = await allNodes();
  const node = all.find((n) => n.id === id);
  if (!node || node.deletedAt) return null;
  if (node.kind === "folder" && isInside(all, id, destParentId)) {
    throw new Error("Can't move a folder into itself");
  }
  if (node.parentId === destParentId) return node;
  node.parentId = destParentId;
  node.name = await uniqueName(destParentId, node.name, id);
  node.updatedAt = Date.now();
  const db = await open();
  await tx(db, ["nodes"], "readwrite", (t) => req(t.objectStore("nodes").put(node)));
  db.close();
  notifyPotion("move");
  return node;
}

export async function setSynced(id: string, synced: boolean) {
  const node = await getNode(id);
  if (!node) return null;
  node.synced = synced;
  node.updatedAt = Date.now();
  const db = await open();
  await tx(db, ["nodes"], "readwrite", (t) => req(t.objectStore("nodes").put(node)));
  db.close();
  notifyPotion("sync");
  return node;
}

export type FolderTarget = { id: string | null; name: string; path: string };

export async function listFolderTargets(excludeId?: string): Promise<FolderTarget[]> {
  const all = (await allNodes()).filter((n) => !n.deletedAt);
  const folders = all.filter((n) => n.kind === "folder");
  const out: FolderTarget[] = [{ id: null, name: "Potion", path: "Potion" }];
  for (const f of folders) {
    if (excludeId && (f.id === excludeId || isInside(all, excludeId, f.id))) continue;
    const crumbs: string[] = [f.name];
    let cur = f.parentId ? all.find((n) => n.id === f.parentId) : undefined;
    const guard = new Set<string>();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      crumbs.unshift(cur.name);
      cur = cur.parentId ? all.find((n) => n.id === cur!.parentId) : undefined;
    }
    out.push({ id: f.id, name: f.name, path: `Potion / ${crumbs.join(" / ")}` });
  }
  return out;
}

export async function trash(id: string) {
  const db = await open();
  const now = Date.now();
  await tx(db, ["nodes"], "readwrite", async (t) => {
    const store = t.objectStore("nodes");
    const all = await req(store.getAll());
    const walk = (nid: string) => {
      const node = all.find((x) => x.id === nid);
      if (!node || node.deletedAt) return;
      node.deletedAt = now;
      node.updatedAt = now;
      store.put(node);
      all.filter((x) => x.parentId === nid && !x.deletedAt).forEach((c) => walk(c.id));
    };
    walk(id);
  });
  db.close();
  notifyPotion("trash");
}

export async function restore(id: string) {
  const db = await open();
  await tx(db, ["nodes"], "readwrite", async (t) => {
    const store = t.objectStore("nodes");
    const node = await req(store.get(id));
    if (!node) return;
    const stamp = node.deletedAt;
    const all = await req(store.getAll());
    const walk = (nid: string) => {
      const n = all.find((x) => x.id === nid);
      if (!n || n.deletedAt !== stamp) return;
      n.deletedAt = null;
      n.updatedAt = Date.now();
      store.put(n);
      all.filter((x) => x.parentId === nid && x.deletedAt === stamp).forEach((c) => walk(c.id));
    };
    walk(id);
  });
  db.close();
  notifyPotion("restore");
}

export async function purge(id: string) {
  const ids: string[] = [];
  const db = await open();
  await tx(db, ["nodes", "blobs", "shares", "comments"], "readwrite", async (t) => {
    const nodes = t.objectStore("nodes");
    const blobs = t.objectStore("blobs");
    const shares = t.objectStore("shares");
    const comments = t.objectStore("comments");
    const all = await req(nodes.getAll());
    const collect = (nid: string) => {
      ids.push(nid);
      all.filter((x) => x.parentId === nid).forEach((c) => collect(c.id));
    };
    collect(id);
    const blobAll = await req(blobs.getAll());
    const shareAll = await req(shares.getAll());
    const commentAll = await req(comments.getAll());
    for (const nid of ids) {
      await req(nodes.delete(nid));
      for (const b of blobAll.filter((x) => x.nodeId === nid)) await req(blobs.delete(b.id));
      for (const s of shareAll.filter((x) => x.nodeId === nid)) await req(shares.delete(s.token));
      for (const c of commentAll.filter((x) => x.nodeId === nid)) await req(comments.delete(c.id));
    }
  });
  db.close();
  for (const nid of ids) await deleteLocalBlobs(nid);
  notifyPotion("purge");
}

export async function emptyTrash() {
  const rows = await listChildren(null, true);
  for (const r of rows) await purge(r.id);
}

export async function search(q: string): Promise<PotionNode[]> {
  const needle = q.trim().toLowerCase();
  if (!needle) return listChildren(null);
  const db = await open();
  const all = await tx(db, ["nodes"], "readonly", (t) => req(t.objectStore("nodes").getAll()));
  db.close();
  return all.filter((n) => !n.deletedAt && n.name.toLowerCase().includes(needle)).slice(0, 80);
}

export async function usedBytes() {
  const db = await open();
  const all = await tx(db, ["nodes"], "readonly", (t) => req(t.objectStore("nodes").getAll()));
  db.close();
  return all.filter((n) => !n.deletedAt && n.kind === "file").reduce((s, n) => s + n.size, 0);
}

export async function currentBlob(nodeId: string): Promise<PotionBlob | undefined> {
  const db = await open();
  const blobs = await tx(db, ["blobs"], "readonly", (t) => req(t.objectStore("blobs").index("node").getAll(nodeId)));
  db.close();
  return blobs.sort((a, b) => b.version - a.version)[0];
}

export async function currentFile(nodeId: string): Promise<{ name: string; mime: string | null; blob: Blob; size: number; version: number } | null> {
  const node = await getNode(nodeId);
  if (!node) return null;
  const fresh = await readLocalBlob(nodeId, node.version);
  if (fresh) return { name: node.name, mime: node.mime, blob: fresh, size: node.size, version: node.version };
  const old = await currentBlob(nodeId);
  if (!old) return null;
  return { name: node.name, mime: old.mime, blob: new Blob([old.bytes], { type: old.mime || "application/octet-stream" }), size: node.size, version: old.version };
}

export async function listVersions(nodeId: string): Promise<PotionVersion[]> {
  const node = await getNode(nodeId);
  const vers = await listLocalVersions(nodeId);
  const set = new Set(vers);
  if (node && !set.has(node.version)) set.add(node.version);
  return [...set].sort((a, b) => b - a).map((version) => ({
    version,
    current: node?.version === version,
    updatedAt: node?.updatedAt ?? 0,
    size: node?.size ?? 0,
  }));
}

export async function revert(nodeId: string, version: number) {
  const node = await getNode(nodeId);
  if (!node) return null;
  const blob = await readLocalBlob(nodeId, version);
  if (!blob) return null;
  const next = node.version + 1;
  node.version = next;
  node.size = blob.size;
  node.hash = await fingerprint(blob);
  node.updatedAt = Date.now();
  const db = await open();
  await tx(db, ["nodes"], "readwrite", (t) => req(t.objectStore("nodes").put(node)));
  db.close();
  await writeLocalBlob(nodeId, next, blob);
  notifyPotion("revert");
  return node;
}

export async function listComments(nodeId: string): Promise<PotionComment[]> {
  const db = await open();
  const rows = await tx(db, ["comments"], "readonly", (t) => req(t.objectStore("comments").index("node").getAll(nodeId)));
  db.close();
  return (rows as PotionComment[]).sort((a, b) => a.createdAt - b.createdAt);
}

export async function stashVersion(nodeId: string, blob: Blob) {
  const node = await getNode(nodeId);
  if (!node) return null;
  const vers = await listLocalVersions(nodeId);
  const next = Math.max(node.version, ...vers, 0) + 1;
  await writeLocalBlob(nodeId, next, blob);
  notifyPotion("stash");
  return next;
}

export async function addComment(nodeId: string, body: string, author?: string | null): Promise<PotionComment> {
  const row: PotionComment = {
    id: nid(),
    nodeId,
    body: body.trim().slice(0, 2000),
    author: (author || "").trim().slice(0, 80) || null,
    createdAt: Date.now(),
  };
  if (!row.body) throw new Error("Empty comment");
  const db = await open();
  await tx(db, ["comments"], "readwrite", (t) => req(t.objectStore("comments").put(row)));
  db.close();
  notifyPotion("comment");
  return row;
}

export async function createShare(nodeId: string, opts: { password?: string; hours?: number }) {
  const share: PotionShare = {
    token: nid().replace(/-/g, "").slice(0, 22),
    nodeId,
    password: opts.password || null,
    expiresAt: opts.hours ? Date.now() + opts.hours * 3600 * 1000 : null,
    createdAt: Date.now(),
  };
  const db = await open();
  await tx(db, ["shares"], "readwrite", (t) => req(t.objectStore("shares").put(share)));
  db.close();
  return share;
}

export async function getShare(token: string) {
  const db = await open();
  const share = await tx(db, ["shares"], "readonly", (t) => req(t.objectStore("shares").get(token)));
  db.close();
  if (!share) return null;
  if (share.expiresAt && share.expiresAt < Date.now()) return null;
  const node = await getNode(share.nodeId);
  if (!node || node.deletedAt) return null;
  return { share, node };
}

export async function stripWelcome() {
  const db = await open();
  const all = await tx(db, ["nodes"], "readonly", (t) => req(t.objectStore("nodes").getAll()));
  db.close();
  for (const n of all) {
    if (n.name === "Welcome to Potion.txt" || n.name === "Read me.txt") {
      await purge(n.id);
    }
  }
}

const OLD_APP_MODULES = new Set(["Finance Manager", "Atrium", "Font Manager"]);

/** One-time: lift leftover Apps children to root. Never wipe Photos/Documents. */
export async function flattenStockFolders() {
  const db = await open();
  const done = await tx(db, ["meta"], "readonly", (t) => req(t.objectStore("meta").get("flat-v14")));
  db.close();
  if (done) return;

  const root = await listChildren(null);
  const apps = root.find((n) => n.kind === "folder" && n.name === "Apps");
  if (apps) {
    const kids = await listChildren(apps.id);
    const leftover = kids.length === 0 || kids.some((k) => OLD_APP_MODULES.has(k.name));
    if (leftover) {
      for (const k of kids) await moveNode(k.id, null);
      await purge(apps.id);
    }
  }
  const after = await listChildren(null);
  for (const n of after) {
    if (n.kind === "folder" && OLD_APP_MODULES.has(n.name)) {
      const kids = await listChildren(n.id);
      if (kids.length === 0) await purge(n.id);
    }
  }
  const db2 = await open();
  await tx(db2, ["meta"], "readwrite", (t) => req(t.objectStore("meta").put({ key: "flat-v14", at: Date.now() })));
  db2.close();
}

export { guessMime };
