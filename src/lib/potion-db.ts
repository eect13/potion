const DB_NAME = "potion-drive";
const DB_VERSION = 1;

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

async function sha256(buf: ArrayBuffer) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function guessMime(name: string) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return (
    {
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".zip": "application/zip",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
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

async function fileNode(
  parentId: string | null,
  name: string,
  bytes: ArrayBuffer,
  mime: string,
  now: number,
) {
  const id = nid();
  const node: PotionNode = {
    id,
    parentId,
    name,
    kind: "file",
    mime,
    size: bytes.byteLength,
    hash: await sha256(bytes),
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    synced: true,
  };
  const blob: PotionBlob = { id: nid(), nodeId: id, version: 1, mime, bytes };
  return { node, blob };
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
  return node;
}

export async function putFiles(parentId: string | null, files: File[]) {
  const db = await open();
  const now = Date.now();
  const existing = await listChildren(parentId);
  const byName = new Map(existing.filter((n) => n.kind === "file").map((n) => [n.name, n]));
  for (const f of files) {
    const bytes = await f.arrayBuffer();
    const mime = f.type || guessMime(f.name);
    const found = byName.get(f.name);
    if (found) {
      const nextVer = found.version + 1;
      found.size = bytes.byteLength;
      found.mime = mime;
      found.hash = await sha256(bytes);
      found.version = nextVer;
      found.updatedAt = now;
      await tx(db, ["nodes", "blobs"], "readwrite", async (t) => {
        await req(t.objectStore("nodes").put(found));
        await req(
          t.objectStore("blobs").put({
            id: nid(),
            nodeId: found.id,
            version: nextVer,
            mime,
            bytes,
          }),
        );
      });
    } else {
      const made = await fileNode(parentId, f.name, bytes, mime, now);
      await tx(db, ["nodes", "blobs"], "readwrite", async (t) => {
        await req(t.objectStore("nodes").put(made.node));
        await req(t.objectStore("blobs").put(made.blob));
      });
      byName.set(f.name, made.node);
    }
  }
  db.close();
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
  return n;
}

async function allNodes(): Promise<PotionNode[]> {
  const db = await open();
  const all = await tx(db, ["nodes"], "readonly", (t) => req(t.objectStore("nodes").getAll()));
  db.close();
  return all;
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
  const blob = await currentBlob(id);
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
  await tx(db, ["nodes", "blobs"], "readwrite", async (t) => {
    await req(t.objectStore("nodes").put(copy));
    if (blob) {
      await req(
        t.objectStore("blobs").put({
          id: nid(),
          nodeId: newId,
          version: 1,
          mime: blob.mime,
          bytes: blob.bytes,
        }),
      );
    }
  });
  db.close();
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
}

export async function purge(id: string) {
  const db = await open();
  await tx(db, ["nodes", "blobs", "shares"], "readwrite", async (t) => {
    const nodes = t.objectStore("nodes");
    const blobs = t.objectStore("blobs");
    const shares = t.objectStore("shares");
    const all = await req(nodes.getAll());
    const ids: string[] = [];
    const collect = (nid: string) => {
      ids.push(nid);
      all.filter((x) => x.parentId === nid).forEach((c) => collect(c.id));
    };
    collect(id);
    const blobAll = await req(blobs.getAll());
    const shareAll = await req(shares.getAll());
    for (const nid of ids) {
      await req(nodes.delete(nid));
      for (const b of blobAll.filter((x) => x.nodeId === nid)) await req(blobs.delete(b.id));
      for (const s of shareAll.filter((x) => x.nodeId === nid)) await req(shares.delete(s.token));
    }
  });
  db.close();
}

export async function emptyTrash() {
  const rows = await listChildren(null, true);
  for (const r of rows) await purge(r.id);
}

export async function recents(): Promise<PotionNode[]> {
  const db = await open();
  const all = await tx(db, ["nodes"], "readonly", (t) => req(t.objectStore("nodes").getAll()));
  db.close();
  return all
    .filter((n) => !n.deletedAt && n.kind === "file")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 40);
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
  const node = await getNode(nodeId);
  if (!node) return;
  const db = await open();
  const blobs = await tx(db, ["blobs"], "readonly", (t) => req(t.objectStore("blobs").index("node").getAll(nodeId)));
  db.close();
  return blobs.sort((a, b) => b.version - a.version)[0];
}

export async function versionsOf(nodeId: string) {
  const node = await getNode(nodeId);
  const db = await open();
  const blobs = await tx(db, ["blobs"], "readonly", (t) => req(t.objectStore("blobs").index("node").getAll(nodeId)));
  db.close();
  return { node, history: blobs.sort((a, b) => b.version - a.version) };
}

export async function revert(nodeId: string, version: number) {
  const { node, history } = await versionsOf(nodeId);
  if (!node) return;
  const v = history.find((h) => h.version === version);
  if (!v) return;
  const next = node.version + 1;
  node.size = v.bytes.byteLength;
  node.mime = v.mime;
  node.hash = await sha256(v.bytes);
  node.version = next;
  node.updatedAt = Date.now();
  const db = await open();
  await tx(db, ["nodes", "blobs"], "readwrite", async (t) => {
    await req(t.objectStore("nodes").put(node));
    await req(
      t.objectStore("blobs").put({
        id: nid(),
        nodeId,
        version: next,
        mime: v.mime,
        bytes: v.bytes,
      }),
    );
  });
  db.close();
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

export async function listShares(): Promise<(PotionShare & { name: string })[]> {
  const db = await open();
  const shares = await tx(db, ["shares"], "readonly", (t) => req(t.objectStore("shares").getAll()));
  const nodes = await tx(db, ["nodes"], "readonly", (t) => req(t.objectStore("nodes").getAll()));
  db.close();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return shares
    .map((s) => ({ ...s, name: byId.get(s.nodeId)?.name || "Missing" }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function revokeShare(token: string) {
  const db = await open();
  await tx(db, ["shares"], "readwrite", (t) => req(t.objectStore("shares").delete(token)));
  db.close();
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

const DROP_ROOT = new Set(["Documents", "Photos", "Apps"]);
const EMPTY_STOCK = new Set(["Finance Manager", "Atrium", "Font Manager"]);

async function folderHasFiles(id: string): Promise<boolean> {
  const kids = await listChildren(id);
  if (kids.some((k) => k.kind === "file")) return true;
  for (const k of kids.filter((x) => x.kind === "folder")) {
    if (await folderHasFiles(k.id)) return true;
  }
  return false;
}

export async function flattenStockFolders() {
  const root = await listChildren(null);
  const apps = root.find((n) => n.kind === "folder" && n.name === "Apps");
  if (apps) {
    const kids = await listChildren(apps.id);
    const db = await open();
    await tx(db, ["nodes"], "readwrite", async (t) => {
      const store = t.objectStore("nodes");
      for (const k of kids) {
        k.parentId = null;
        k.updatedAt = Date.now();
        await req(store.put(k));
      }
    });
    db.close();
    await purge(apps.id);
  }
  const again = await listChildren(null);
  for (const n of again) {
    if (n.kind === "folder" && DROP_ROOT.has(n.name)) await purge(n.id);
  }
  const stock = await listChildren(null);
  for (const n of stock) {
    if (n.kind === "folder" && EMPTY_STOCK.has(n.name) && !(await folderHasFiles(n.id))) {
      await purge(n.id);
    }
  }
}

export { guessMime };
