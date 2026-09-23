import * as db from "@/lib/potion-db";
import type { PotionComment, PotionNode, PotionVersion } from "@/lib/potion-db";
import * as cloud from "@/lib/potion-cloud";
import { assertRoom, fingerprint, fromBase64, readLocalBlob, toBase64, writeLocalBlob } from "@/lib/potion-blob";
import { notifyPotion } from "@/lib/potion-watch";
import { clearJob, jobFor, listJobs, saveJob } from "@/lib/potion-resume";
import { getBearerToken } from "@/lib/auth/client";

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

const NET = 8 * 1024 * 1024;

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
        out.push({ node: k, path, parentPath: pre });
      }
    }
  };
  walk(parentId, prefix);
  return out;
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
) {
  const from = start - (start % NET);
  if (blob.size === 0 || from >= blob.size) {
    onProgress?.({ done: 1, total: 1, name });
    return;
  }
  const total = Math.max(1, Math.ceil(blob.size / NET));
  let done = Math.floor(from / NET);
  for (let offset = from; offset < blob.size; offset += NET) {
    const slice = blob.slice(offset, Math.min(offset + NET, blob.size));
    const buf = await slice.arrayBuffer();
    await cloud.putBlobChunk({ data: { id, version, offset, data: toBase64(buf) } });
    done += 1;
    onProgress?.({ done, total, name });
  }
}

async function downloadChunks(id: string, version: number, size: number, mime: string | null) {
  const cached = await readLocalBlob(id, version);
  if (cached && cached.size === size) return cached;
  const parts: BlobPart[] = [];
  for (let offset = 0; offset < size; offset += NET) {
    const chunk = await cloud.getBlobChunk({
      data: { id, version, offset, length: NET },
    });
    if (!chunk.read) break;
    parts.push(fromBase64(chunk.data));
  }
  const blob = new Blob(parts, { type: mime || "application/octet-stream" });
  if (blob.size) await writeLocalBlob(id, version, blob);
  return blob;
}

async function putCloudBlob(
  parentId: string | null,
  name: string,
  mime: string,
  blob: Blob,
  onProgress?: (p: PutProgress) => void,
  local?: { id: string; version: number },
) {
  const hash = await fingerprint(blob);
  const pending = jobFor(hash);
  let started =
    pending?.cloudId && pending.version && pending.size === blob.size
      ? { id: pending.cloudId, version: pending.version }
      : await cloud.putCloud({ data: { parentId, name, mime, size: blob.size, hash } });
  saveJob({
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
  let offset = 0;
  try {
    const stat = await cloud.statBlob({ data: { id: started.id, version: started.version } });
    offset = Math.min(stat.size, blob.size);
  } catch {
    offset = 0;
  }
  await uploadChunks(started.id, started.version, blob, name, onProgress, offset);
  await cloud.commitCloud({
    data: { id: started.id, version: started.version, hash, size: blob.size, mime },
  });
  clearJob(hash);
  afterCloud();
  return started;
}

export async function resumeUploads(onProgress?: (p: PutProgress) => void) {
  for (const job of listJobs()) {
    if (!job.localId || !job.localVersion || !job.hash) continue;
    const blob = await readLocalBlob(job.localId, job.localVersion);
    if (!blob || blob.size !== job.size) continue;
    await putCloudBlob(job.parentId, job.name, job.mime, blob, onProgress, {
      id: job.localId,
      version: job.localVersion,
    });
  }
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

export async function getFile(mode: StoreMode, id: string): Promise<PotionFile | null> {
  if (mode === "cloud") {
    const file = await cloud.getCloud({ data: id });
    if (!file) return null;
    const blob = await downloadChunks(id, file.version, file.size, file.mime);
    return { name: file.name, mime: file.mime, blob, size: file.size, version: file.version };
  }
  return db.currentFile(id);
}

export async function putLocalFile(parentPath: string, name: string, mime: string | null, blob: Blob) {
  const parentId = await ensureFolderPath(
    "local",
    parentPath.split("/").filter(Boolean),
  );
  await db.putFiles(parentId, [asFile(name, mime, blob)]);
}

export async function putCloudFile(parentPath: string, name: string, mime: string | null, blob: Blob) {
  const parentId = await ensureFolderPath(
    "cloud",
    parentPath.split("/").filter(Boolean),
  );
  await putCloudBlob(parentId, name, mime || db.guessMime(name), blob);
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
  const parts: BlobPart[] = [];
  for (let offset = 0; offset < file.size; offset += NET) {
    const chunk = await cloud.getSharedBlobChunk({
      data: { token, id, version: file.version, offset, length: NET },
    });
    if (!chunk.read) break;
    parts.push(fromBase64(chunk.data));
  }
  const blob = new Blob(parts, { type: file.mime || "application/octet-stream" });
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

export function mediaUrl(node: { id: string; version: number }, token?: string) {
  const q = new URLSearchParams({ id: node.id, version: String(node.version || 1) });
  if (token) q.set("token", token);
  else {
    const bearer = getBearerToken();
    if (bearer) q.set("bearer", bearer);
  }
  return `/api/potion-file?${q}`;
}

export async function listSharedComments(token: string) {
  return cloud.listSharedComments({ data: token });
}

export async function addSharedComment(token: string, body: string, author: string) {
  return cloud.addSharedComment({ data: { token, body, author } });
}
