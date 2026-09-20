import * as db from "@/lib/potion-db";
import type { PotionComment, PotionNode, PotionVersion } from "@/lib/potion-db";
import * as cloud from "@/lib/potion-cloud";
import { fingerprint, fromBase64, readLocalBlob, SLICE, toBase64, writeLocalBlob } from "@/lib/potion-blob";
import { notifyPotion } from "@/lib/potion-watch";

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
) {
  if (blob.size === 0) {
    onProgress?.({ done: 1, total: 1, name });
    return;
  }
  const total = Math.max(1, Math.ceil(blob.size / SLICE));
  let done = 0;
  for (let offset = 0; offset < blob.size; offset += SLICE) {
    const slice = blob.slice(offset, Math.min(offset + SLICE, blob.size));
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
  for (let offset = 0; offset < size; offset += SLICE) {
    const chunk = await cloud.getBlobChunk({
      data: { id, version, offset, length: SLICE },
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
) {
  const hash = await fingerprint(blob);
  const started = await cloud.putCloud({
    data: { parentId, name, mime, size: blob.size, hash },
  });
  await uploadChunks(started.id, started.version, blob, name, onProgress);
  await cloud.commitCloud({
    data: { id: started.id, version: started.version, hash, size: blob.size, mime },
  });
  afterCloud();
  return started;
}

export async function putFiles(
  mode: StoreMode,
  parentId: string | null,
  files: File[],
  onProgress?: (p: PutProgress) => void,
) {
  if (mode === "cloud") {
    for (const f of files) {
      await putCloudBlob(parentId, f.name, f.type || db.guessMime(f.name), f, onProgress);
    }
    try {
      const crumbs = await pathOf("cloud", parentId);
      const localParent = await ensureFolderPath(
        "local",
        crumbs.map((c) => c.name),
      );
      await db.putFiles(localParent, files);
    } catch {
      /* local cache is optional */
    }
    return;
  }
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
  for (let offset = 0; offset < file.size; offset += SLICE) {
    const chunk = await cloud.getSharedBlobChunk({
      data: { token, id, version: file.version, offset, length: SLICE },
    });
    if (!chunk.read) break;
    parts.push(fromBase64(chunk.data));
  }
  const blob = new Blob(parts, { type: file.mime || "application/octet-stream" });
  return { name: file.name, mime: file.mime, blob, size: file.size, version: file.version };
}
