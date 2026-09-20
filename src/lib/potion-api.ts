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

export type RestoreRecord = {
  id: string;
  fileName: string;
  deviceKind: string;
  restoredAt: string;
};

export type ConnectedApp = {
  id: string;
  name: string;
  folderId: string;
  files: number;
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

export async function pathOf(mode: StoreMode, id: string | null) {
  if (mode === "cloud") return cloud.pathCloud({ data: id });
  return db.pathOf(id);
}

export async function mkdir(mode: StoreMode, parentId: string | null, name: string) {
  if (mode === "cloud") return cloud.mkdirCloud({ data: { parentId, name } });
  return db.mkdir(parentId, name);
}

export async function collectTree(
  mode: StoreMode,
  parentId: string | null = null,
  prefix = "",
): Promise<TreeEntry[]> {
  const kids = await listNodes(mode, parentId);
  const out: TreeEntry[] = [];
  for (const k of kids) {
    const path = prefix ? `${prefix}/${k.name}` : k.name;
    if (k.kind === "folder") {
      if (k.synced === false) continue;
      out.push({ node: k, path, parentPath: prefix });
      out.push(...(await collectTree(mode, k.id, path)));
    } else {
      out.push({ node: k, path, parentPath: prefix });
    }
  }
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
  await putFiles("cloud", parentId, [asFile(name, mime, bytes)]);
}

export function spaceKey() {
  return "";
}

export function lastRestore(): RestoreRecord | null {
  return null;
}

export async function connectedApps(_mode: StoreMode): Promise<ConnectedApp[]> {
  return [];
}

export async function addConnectedApp(_mode: StoreMode, _name: string) {
  throw new Error("Apps was removed. Use Folder.");
}

export async function removeConnectedApp(_name: string) {}

export async function ensureAppFolder(_mode: StoreMode, _name: string) {
  return "";
}

export async function listAppBackups(_mode: StoreMode, _app: string) {
  return { folderId: "", files: [] as PotionNode[] };
}

export async function saveAppBackup(_mode: StoreMode, _app: string, _payload: string) {
  throw new Error("Apps was removed. Use Folder.");
}

export async function restoreBackup(_mode: StoreMode, _id: string, _device: string) {
  throw new Error("Apps was removed. Use Folder.");
}
