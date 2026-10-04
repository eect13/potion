import * as db from "@/lib/potion-db";
import type { PotionComment, PotionNode, PotionVersion } from "@/lib/potion-db";
import * as cloud from "@/lib/potion-cloud";
import { assertRoom, deleteLocalVersion, fingerprint, fromBase64, loadLeafList, pruneLocal, readLocalBlob, saveLeafList, toBase64, writeLocalSlice } from "@/lib/potion-blob";
import { LEAF, leafDigests, merkleRoot, sha256, treeLevels, walkDirty } from "@/lib/potion-merkle";
import { notifyPotion } from "@/lib/potion-watch";
import { clearJob, jobFor, listJobs, jobKey, saveJob } from "@/lib/potion-resume";
import { withPotionLock } from "@/lib/potion-lock";

export type { PotionComment, PotionNode, PotionVersion };
export type StoreMode = "local" | "cloud";

export type PotionFile = {
  name: string;
  mime: string | null;
  blob: Blob;
  size: number;
  version: number;
};

export type TreeEntry = {
  node: PotionNode;
  path: string;
  parentPath: string;
};

export type PutProgress = { done: number; total: number; name: string };

const NET = LEAF;

function asFile(name: string, mime: string | null, blob: Blob) {
  return new File([blob], name, { type: mime || blob.type || "application/octet-stream" });
}

function afterCloud() {
  notifyPotion("cloud");
}

export async function ensurePotion(mode: StoreMode) {
  if (mode === "cloud") {
    await cloud.ensureCloud();
    return;
  }
  await db.ensureSeeded();
  await db.stripWelcome();
  await db.flattenStockFolders();
}

async function mkdirId(mode: StoreMode, parentId: string | null, name: string): Promise<string> {
  if (mode === "cloud") {
    const made = await cloud.mkdirCloud({ data: { parentId, name } });
    afterCloud();
    return made.id;
  }
  const node = await db.mkdir(parentId, name);
  return node.id;
}

export async function listNodes(mode: StoreMode, parentId: string | null) {
  if (mode === "cloud") return cloud.listCloud({ data: parentId });
  await db.ensureSeeded();
  return db.listChildren(parentId);
}

export async function listTrash(mode: StoreMode) {
  if (mode === "cloud") return cloud.listTrashCloud();
  await db.ensureSeeded();
  const all = await db.listChildren(null, true);
  const deleted = new Set(all.map((n) => n.id));
  return all.filter((n) => !n.parentId || !deleted.has(n.parentId));
}

export async function pathOf(mode: StoreMode, id: string | null) {
  if (mode === "cloud") return cloud.pathCloud({ data: id });
  return db.pathOf(id);
}

export async function mkdir(mode: StoreMode, parentId: string | null, name: string) {
  if (mode === "cloud") {
    const made = await cloud.mkdirCloud({ data: { parentId, name } });
    afterCloud();
    return made;
  }
  return db.mkdir(parentId, name);
}

export async function renameNode(mode: StoreMode, id: string, name: string) {
  if (mode === "cloud") {
    const r = await cloud.renameCloud({ data: { id, name } });
    afterCloud();
    return r;
  }
  return db.rename(id, name);
}

export async function searchNodes(mode: StoreMode, q: string) {
  if (mode === "cloud") return cloud.searchCloud({ data: q });
  return db.search(q);
}

export async function usedBytes(mode: StoreMode) {
  if (mode === "cloud") {
    const r = await cloud.usedBytesCloud();
    return r.bytes;
  }
  return db.usedBytes();
}

export async function collectTree(
  mode: StoreMode,
  parentId: string | null = null,
  prefix = "",
): Promise<TreeEntry[]> {
  const all = mode === "cloud" ? await cloud.listAllCloud() : await db.listAlive();
  const byParent = new Map<string | null, PotionNode[]>();
  for (const n of all) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  const out: TreeEntry[] = [];
  const walk = (pid: string | null, pre: string) => {
    for (const k of byParent.get(pid) ?? []) {
      const path = pre ? `${pre}/${k.name}` : k.name;
      if (k.kind === "folder") {
        if (k.synced === false) continue;
        out.push({ node: k, path, parentPath: pre });
        walk(k.id, path);
      } else {
        if (k.synced === false) continue;
        out.push({ node: k, path, parentPath: pre });
      }
    }
  };
  walk(parentId, prefix);
  return out;
}

export async function driveRoot() {
  const row = await cloud.driveRootCloud();
  return row.root;
}

export async function ensureFolderPath(mode: StoreMode, parts: string[]): Promise<string | null> {
  let parent: string | null = null;
  for (const part of parts) {
    if (!part) continue;
    const kids = await listNodes(mode, parent);
    const found = kids.find((n) => n.kind === "folder" && n.name === part);
    parent = found ? found.id : await mkdirId(mode, parent, part);
  }
  return parent;
}

async function uploadChunks(
  id: string,
  version: number,
  blob: Blob,
  name: string,
  onProgress?: (p: PutProgress) => void,
  start = 0,
  only?: number[] | null,
) {
  if (blob.size === 0) {
    onProgress?.({ done: 1, total: 1, name });
    return;
  }
  const total = Math.max(1, Math.ceil(blob.size / NET));
  const offsets =
    only ??
    Array.from({ length: Math.ceil((blob.size - (start - (start % NET))) / NET) }, (_, i) => {
      const from = start - (start % NET);
      return from + i * NET;
    }).filter((offset) => offset < blob.size);
  let done = total - offsets.length;
  if (!offsets.length) {
    onProgress?.({ done: total, total, name });
    return;
  }
  for (const offset of offsets) {
    const slice = blob.slice(offset, Math.min(offset + NET, blob.size));
    const buf = new Uint8Array(await slice.arrayBuffer());
    const digest = await sha256(buf);
    await cloud.putBlobChunk({ data: { id, version, offset, data: toBase64(buf), digest } });
    done += 1;
    onProgress?.({ done, total, name });
  }
}

type Chunk = { data: string; read: number; digest?: string };

/** Stream slices onto disk. Return the file only when the byte count matches. */
async function pullChunks(
  id: string,
  version: number,
  size: number,
  mime: string | null,
  read: (offset: number, length: number) => Promise<Chunk>,
) {
  if (size === 0) return new Blob([], { type: mime || "application/octet-stream" });
  const cached = await readLocalBlob(id, version);
  if (cached && cached.size === size) return cached;
  if (cached) await deleteLocalVersion(id, version);
  let got = 0;
  try {
    for (let offset = 0; offset < size; offset += NET) {
      const length = Math.min(NET, size - offset);
      const chunk = await read(offset, length);
      if (chunk.read !== length) throw new Error("Download incomplete");
      const bytes = fromBase64(chunk.data);
      if (bytes.byteLength !== length) throw new Error("Download incomplete");
      if (chunk.digest && (await sha256(bytes)) !== chunk.digest) throw new Error("Download did not match");
      await writeLocalSlice(id, version, bytes, offset);
      got += bytes.byteLength;
    }
  } catch (err) {
    await deleteLocalVersion(id, version);
    throw err;
  }
  const file = await readLocalBlob(id, version);
  if (!file || file.size !== size || got !== size) {
    await deleteLocalVersion(id, version);
    throw new Error("Download incomplete");
  }
  await pruneLocal(id, version);
  return file;
}

async function downloadChunks(id: string, version: number, size: number, mime: string | null) {
  return pullChunks(id, version, size, mime, async (offset, length) => {
    return cloud.getBlobChunk({ data: { id, version, offset, length } });
  });
}

/** Pull only slices the tree says differ from the copy already on this device. */
async function downloadDelta(id: string, version: number, size: number, mime: string | null, baseLocalId?: string) {
  const full = () => downloadChunks(id, version, size, mime);
  if (!baseLocalId || size === 0) return full();
  const base = await db.currentFile(baseLocalId);
  if (!base?.blob) return full();
  let leaves = await loadLeafList(baseLocalId, base.version);
  if (!leaves || leaves.length !== Math.ceil(base.blob.size / LEAF)) {
    leaves = await leafDigests(base.blob);
    await saveLeafList(baseLocalId, base.version, leaves).catch(() => undefined);
  }
  const levels = await treeLevels(leaves);
  const dirty = await walkDirty(levels, async (depth, nodes) => {
    return cloud.probeBlob({ data: { id, version, depth, nodes } });
  });
  if (!dirty) return full();
  if (!dirty.length && base.blob.size === size) return base.blob;
  await deleteLocalVersion(id, version);
  const dirtySet = new Set(dirty);
  const total = Math.ceil(size / LEAF);
  try {
    for (let i = 0; i < total; i++) {
      const offset = i * LEAF;
      const length = Math.min(LEAF, size - offset);
      if (!dirtySet.has(i) && offset + length <= base.blob.size) {
        const bytes = new Uint8Array(await base.blob.slice(offset, offset + length).arrayBuffer());
        if (bytes.byteLength === length) {
          await writeLocalSlice(id, version, bytes, offset);
          continue;
        }
      }
      const chunk = await cloud.getBlobChunk({ data: { id, version, offset, length } });
      if (chunk.read !== length) throw new Error("Download incomplete");
      const bytes = fromBase64(chunk.data);
      if (bytes.byteLength !== length) throw new Error("Download incomplete");
      if (chunk.digest && (await sha256(bytes)) !== chunk.digest) throw new Error("Download did not match");
      await writeLocalSlice(id, version, bytes, offset);
    }
  } catch (err) {
    await deleteLocalVersion(id, version);
    throw err;
  }
  const file = await readLocalBlob(id, version);
  if (!file || file.size !== size) {
    await deleteLocalVersion(id, version);
    throw new Error("Download incomplete");
  }
  await pruneLocal(id, version);
  return file;
}

async function putCloudBlob(
  parentId: string | null,
  name: string,
  mime: string,
  blob: Blob,
  onProgress?: (p: PutProgress) => void,
  local?: { id: string; version: number },
  existingId?: string | null,
) {
  const stored = local ? await loadLeafList(local.id, local.version) : null;
  const leaves = stored && stored.length === Math.ceil(blob.size / LEAF) ? stored : await leafDigests(blob);
  if (local) await saveLeafList(local.id, local.version, leaves).catch(() => undefined);
  const hash = await merkleRoot(leaves, blob.size);
  const pending = jobFor(parentId, name);
  const started =
    pending?.cloudId && pending.version && pending.hash === hash && pending.size === blob.size
      ? { id: pending.cloudId, version: pending.version }
      : await cloud.putCloud({ data: { parentId, name, mime, size: blob.size, hash, existingId: existingId ?? null } });
  saveJob({
    key: jobKey(parentId, name),
    hash,
    name,
    mime,
    size: blob.size,
    parentId,
    cloudId: started.id,
    version: started.version,
    localId: local?.id,
    localVersion: local?.version,
  });
  let only: number[] | null = null;
  if (started.version > 1 && blob.size > 0) {
    try {
      const levels = await treeLevels(leaves);
      const dirty = await walkDirty(levels, async (depth, nodes) => {
        return cloud.probeBlob({ data: { id: started.id, version: started.version - 1, depth, nodes } });
      });
      if (dirty) {
        const copied = await cloud.copyCleanBlob({ data: { id: started.id, version: started.version, size: blob.size, dirty } });
        if (copied.copied) only = dirty.map((i) => i * LEAF);
      }
    } catch {
      only = null;
    }
    if (!only) {
      try {
        const seeded = await cloud.seedBlob({ data: { id: started.id, version: started.version, leaves, size: blob.size } });
        only = seeded.missing;
      } catch {
        only = null;
      }
    }
  }
  let offset = 0;
  if (!only) {
    try {
      const stat = await cloud.statBlob({ data: { id: started.id, version: started.version } });
      offset = Math.min(stat.size, blob.size);
    } catch {
      offset = 0;
    }
  }
  await uploadChunks(started.id, started.version, blob, name, onProgress, offset, only);
  await cloud.commitCloud({
    data: { id: started.id, version: started.version, hash, size: blob.size, mime },
  });
  clearJob(parentId, name);
  afterCloud();
  return started;
}

export async function resumeUploads(onProgress?: (p: PutProgress) => void) {
  const held = await withPotionLock("sync", async () => {
    for (const job of listJobs()) {
      if (!job.localId || !job.localVersion || !job.hash) continue;
      const blob = await readLocalBlob(job.localId, job.localVersion);
      if (!blob || blob.size !== job.size) continue;
      await putCloudBlob(job.parentId, job.name, job.mime, blob, onProgress, {
        id: job.localId,
        version: job.localVersion,
      });
    }
  });
  return held === "busy" ? undefined : held;
}

export async function putFiles(
  mode: StoreMode,
  parentId: string | null,
  files: File[],
  onProgress?: (p: PutProgress) => void,
) {
  if (mode === "cloud") {
    let localParent: string | null = null;
    try {
      const crumbs = await pathOf("cloud", parentId);
      localParent = await ensureFolderPath(
        "local",
        crumbs.map((c) => c.name),
      );
    } catch {
      localParent = null;
    }
    for (const f of files) {
      await assertRoom(f.size);
      const mime = f.type || db.guessMime(f.name);
      const saved = await db.putFiles(localParent, [f]).catch(() => []);
      const local = saved[0];
      await putCloudBlob(parentId, f.name, mime, f, onProgress, local ? { id: local.id, version: local.version } : undefined);
    }
    return;
  }
  for (const f of files) await assertRoom(f.size);
  return db.putFiles(parentId, files);
}

export async function trashNode(mode: StoreMode, id: string) {
  if (mode === "cloud") {
    const r = await cloud.trashCloud({ data: id });
    afterCloud();
    return r;
  }
  return db.trash(id);
}

export async function restoreNode(mode: StoreMode, id: string) {
  if (mode === "cloud") {
    const r = await cloud.restoreCloud({ data: id });
    afterCloud();
    return r;
  }
  return db.restore(id);
}

export async function purgeNode(mode: StoreMode, id: string) {
  if (mode === "cloud") {
    const r = await cloud.purgeCloud({ data: id });
    afterCloud();
    return r;
  }
  return db.purge(id);
}

export async function emptyTrash(mode: StoreMode) {
  if (mode === "cloud") {
    const r = await cloud.emptyTrashCloud();
    afterCloud();
    return r;
  }
  return db.emptyTrash();
}

export async function copyNode(mode: StoreMode, id: string, destParentId: string | null) {
  if (mode === "cloud") {
    const r = await cloud.copyCloud({ data: { id, destParentId } });
    afterCloud();
    return r;
  }
  return db.copyNode(id, destParentId);
}

export async function moveNode(mode: StoreMode, id: string, destParentId: string | null) {
  if (mode === "cloud") {
    const r = await cloud.moveCloud({ data: { id, destParentId } });
    afterCloud();
    return r;
  }
  return db.moveNode(id, destParentId);
}

export async function setSynced(mode: StoreMode, id: string, synced: boolean) {
  if (mode === "cloud") {
    const r = await cloud.syncCloud({ data: { id, synced } });
    afterCloud();
    return r;
  }
  return db.setSynced(id, synced);
}

export async function shareNode(mode: StoreMode, id: string) {
  if (mode === "cloud") return cloud.shareCloud({ data: id });
  return db.createShare(id, {});
}

export async function listFolderTargets(mode: StoreMode, excludeId?: string) {
  if (mode === "cloud") return cloud.listTargetsCloud({ data: excludeId ?? null });
  return db.listFolderTargets(excludeId);
}

export async function getFile(mode: StoreMode, id: string, baseLocalId?: string): Promise<PotionFile | null> {
  if (mode === "cloud") {
    const file = await cloud.getCloud({ data: id });
    if (!file) return null;
    const blob = await downloadDelta(id, file.version, file.size, file.mime, baseLocalId);
    return { name: file.name, mime: file.mime, blob, size: file.size, version: file.version };
  }
  return db.currentFile(id);
}

export async function putLocalFile(parentPath: string, name: string, mime: string | null, blob: Blob) {
  const parentId = await ensureFolderPath(
    "local",
    parentPath.split("/").filter(Boolean),
  );
  const written = await db.putFiles(parentId, [asFile(name, mime, blob)]);
  return written[0] ?? null;
}

export async function putCloudFile(
  parentPath: string,
  name: string,
  mime: string | null,
  blob: Blob,
  existingId?: string,
  local?: { id: string; version: number },
) {
  const parentId = await ensureFolderPath(
    "cloud",
    parentPath.split("/").filter(Boolean),
  );
  return putCloudBlob(parentId, name, mime || db.guessMime(name), blob, undefined, local, existingId);
}

export async function placeCloud(id: string, parentPath: string, name: string) {
  const parentId = await ensureFolderPath("cloud", parentPath.split("/").filter(Boolean));
  await cloud.moveCloud({ data: { id, destParentId: parentId } });
  await cloud.renameCloud({ data: { id, name } });
  afterCloud();
}

export async function placeLocal(id: string, parentPath: string, name: string) {
  const parentId = await ensureFolderPath("local", parentPath.split("/").filter(Boolean));
  const node = await db.getNode(id);
  if (!node) return;
  if (node.parentId !== parentId) await db.moveNode(id, parentId);
  const current = await db.getNode(id);
  if (current && current.name !== name) await db.rename(id, name);
}

export async function linkPeer(localId: string, cloudId: string) {
  await db.setPeer(localId, cloudId);
}

export async function loadMarks() {
  return db.loadSyncMarks();
}

export async function saveMark(cloudId: string, mark: db.IdentMark) {
  await db.saveSyncMark(cloudId, mark);
}

export async function identFor(localId: string) {
  const node = await db.getNode(localId);
  if (!node) return "";
  const parent = node.parentId ? await db.getNode(node.parentId) : null;
  return `${parent?.peerId ?? ""}/${node.name}`;
}

export async function forgetBase(path: string) {
  if (!path || path.startsWith("id:")) return;
  await cloud.forgetBaseCloud({ data: path });
}

export async function revokeShare(mode: StoreMode, token: string) {
  if (mode === "cloud") return cloud.revokeShareCloud({ data: token });
  return db.revokeShare(token);
}

export async function expireShare(mode: StoreMode, token: string, hours: number) {
  if (mode === "cloud") return cloud.expireShareCloud({ data: { token, hours } });
  return db.expireShare(token, hours);
}

export async function listVersions(mode: StoreMode, id: string): Promise<PotionVersion[]> {
  if (mode === "cloud") return cloud.listVersionsCloud({ data: id });
  return db.listVersions(id);
}

export async function revertNode(mode: StoreMode, id: string, version: number) {
  if (mode === "cloud") {
    const r = await cloud.revertCloud({ data: { id, version } });
    afterCloud();
    return r;
  }
  return db.revert(id, version);
}

export async function listComments(mode: StoreMode, id: string): Promise<PotionComment[]> {
  if (mode === "cloud") return cloud.listCommentsCloud({ data: id });
  return db.listComments(id);
}

export async function addComment(mode: StoreMode, id: string, body: string) {
  if (mode === "cloud") {
    const row = await cloud.addCommentCloud({ data: { id, body } });
    afterCloud();
    return row;
  }
  return db.addComment(id, body);
}

export async function pullSharedFile(token: string, id: string): Promise<PotionFile | null> {
  const file = await cloud.getSharedFileCloud({ data: { token, id } });
  if (!file) return null;
  const blob = await pullChunks(id, file.version, file.size, file.mime, async (offset, length) => {
    return cloud.getSharedBlobChunk({ data: { token, id, version: file.version, offset, length } });
  });
  return { name: file.name, mime: file.mime, blob, size: file.size, version: file.version };
}

export type SyncBase = { hash: string | null; conflict: string | null };

export async function loadBases(): Promise<Record<string, SyncBase>> {
  const rows = await cloud.listBasesCloud();
  return Object.fromEntries(rows.map((r) => [r.path, { hash: r.hash, conflict: r.conflict }]));
}

export async function rememberBase(path: string, hash: string | null, conflict: string | null) {
  await cloud.setBaseCloud({ data: { path, hash, conflict } });
}

export async function keepBoth(localId: string, remoteId: string) {
  const local = await db.currentFile(localId);
  const remote = await getFile("cloud", remoteId);
  if (remote) await db.stashVersion(localId, remote.blob);
  if (local) {
    const hash = local.blob.size ? await fingerprint(local.blob) : "";
    const started = await cloud.beginStashCloud({ data: remoteId });
    await uploadChunks(started.id, started.version, local.blob, local.name);
    await cloud.commitStashCloud({
      data: {
        id: started.id,
        version: started.version,
        hash: hash || local.blob.size.toString(16),
        size: local.blob.size,
        mime: local.mime || "application/octet-stream",
      },
    });
  }
  afterCloud();
}

let mediaTicket = "";
let mediaTicketAt = 0;

export async function warmMediaTicket() {
  if (mediaTicket && Date.now() - mediaTicketAt < 10 * 60 * 1000) return mediaTicket;
  const minted = await cloud.mediaTicketCloud();
  mediaTicket = minted.ticket;
  mediaTicketAt = Date.now();
  return mediaTicket;
}

export function mediaUrl(node: { id: string; version: number }, token?: string) {
  const q = new URLSearchParams({ id: node.id, version: String(node.version || 1) });
  if (token) q.set("token", token);
  else if (mediaTicket) q.set("ticket", mediaTicket);
  let base = "";
  try {
    base = (localStorage.getItem("potion-server") || "").replace(/\/$/, "");
  } catch {
    base = "";
  }
  return `${base}/api/potion-file?${q}`;
}

export async function listSharedComments(token: string) {
  return cloud.listSharedComments({ data: token });
}

export async function addSharedComment(token: string, body: string, author: string) {
  return cloud.addSharedComment({ data: { token, body, author } });
}
