import * as db from "@/lib/potion-db";
import type { PotionNode } from "@/lib/potion-db";
import * as cloud from "@/lib/potion-cloud";

export type { PotionNode };
export type StoreMode = "local" | "cloud";

export type TreeEntry = {
  node: PotionNode;
  path: string;
  parentPath: string;
};

async function fileToB64(file: Blob) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function asFile(name: string, mime: string | null, bytes: ArrayBuffer) {
  return new File([bytes], name, { type: mime || "application/octet-stream" });
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
  if (mode === "cloud") return cloud.mkdirCloud({ data: { parentId, name } });
  return db.mkdir(parentId, name);
}

export async function renameNode(mode: StoreMode, id: string, name: string) {
  if (mode === "cloud") return cloud.renameCloud({ data: { id, name } });
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

export async function putFiles(mode: StoreMode, parentId: string | null, files: File[]) {
  if (mode === "cloud") {
    for (const f of files) {
      await cloud.putCloud({
        data: {
          parentId,
          name: f.name,
          mime: f.type || db.guessMime(f.name),
          content: await fileToB64(f),
        },
      });
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
  if (mode === "cloud") return cloud.trashCloud({ data: id });
  return db.trash(id);
}

export async function restoreNode(mode: StoreMode, id: string) {
  if (mode === "cloud") return cloud.restoreCloud({ data: id });
  return db.restore(id);
}

export async function purgeNode(mode: StoreMode, id: string) {
  if (mode === "cloud") return cloud.purgeCloud({ data: id });
  return db.purge(id);
}

export async function emptyTrash(mode: StoreMode) {
  if (mode === "cloud") return cloud.emptyTrashCloud();
  return db.emptyTrash();
}

export async function copyNode(mode: StoreMode, id: string, destParentId: string | null) {
  if (mode === "cloud") return cloud.copyCloud({ data: { id, destParentId } });
  return db.copyNode(id, destParentId);
}

export async function moveNode(mode: StoreMode, id: string, destParentId: string | null) {
  if (mode === "cloud") return cloud.moveCloud({ data: { id, destParentId } });
  return db.moveNode(id, destParentId);
}

export async function setSynced(mode: StoreMode, id: string, synced: boolean) {
  if (mode === "cloud") return cloud.syncCloud({ data: { id, synced } });
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

export async function getFile(mode: StoreMode, id: string) {
  if (mode === "cloud") {
    const file = await cloud.getCloud({ data: id });
    if (!file) return null;
    return {
      name: file.name,
      mime: file.mime,
      bytes: b64ToBytes(file.content).buffer,
      size: file.size,
    };
  }
  const node = await db.getNode(id);
  const blob = await db.currentBlob(id);
  if (!node || !blob) return null;
  return { name: node.name, mime: blob.mime, bytes: blob.bytes, size: node.size };
}

export async function putLocalFile(parentPath: string, name: string, mime: string | null, bytes: ArrayBuffer) {
  const parentId = await ensureFolderPath(
    "local",
    parentPath.split("/").filter(Boolean),
  );
  await db.putFiles(parentId, [asFile(name, mime, bytes)]);
}

export async function putCloudFile(parentPath: string, name: string, mime: string | null, bytes: ArrayBuffer) {
  const parentId = await ensureFolderPath(
    "cloud",
    parentPath.split("/").filter(Boolean),
  );
  await cloud.putCloud({
    data: {
      parentId,
      name,
      mime: mime || db.guessMime(name),
      content: await fileToB64(new Blob([bytes])),
    },
  });
}
