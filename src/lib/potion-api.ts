import * as db from "@/lib/potion-db";
import type { PotionNode } from "@/lib/potion-db";
import * as cloud from "@/lib/potion-cloud";
import * as registry from "@/lib/potion-apps";

export type { PotionNode };
export type StoreMode = "local" | "cloud";
export const APPS_FOLDER_NAME = "Apps";

const RESERVED_APP_NAMES = new Set(["apps", "documents", "photos", "potion"]);

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

export type TreeEntry = {
  node: PotionNode;
  path: string;
  parentPath: string;
};

const RESTORE_KEY = "potion-last-restore";
const SPACE_KEY = "potion-space";

export function spaceKey() {
  let key = localStorage.getItem(SPACE_KEY);
  if (!key) {
    key = `pot_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    localStorage.setItem(SPACE_KEY, key);
  }
  return key;
}

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
    await nestConnectedApps(mode);
    return;
  }
  await db.ensureSeeded();
  await db.stripWelcome();
  await db.flattenStockFolders();
  await nestConnectedApps(mode);
}

async function mkdirId(mode: StoreMode, parentId: string | null, name: string): Promise<string> {
  if (mode === "cloud") {
    const made = await cloud.mkdirCloud({ data: { parentId, name } });
    return made.id;
  }
  const node = await db.mkdir(parentId, name);
  return node.id;
}

export async function ensureAppsRoot(mode: StoreMode): Promise<string> {
  const root = await listNodes(mode, null);
  const found = root.find((n) => n.kind === "folder" && n.name === APPS_FOLDER_NAME);
  if (found) return found.id;
  return mkdirId(mode, null, APPS_FOLDER_NAME);
}

async function nestConnectedApps(mode: StoreMode) {
  const appsId = await ensureAppsRoot(mode);
  const names = new Set(registry.listAppNames().map((n) => n.toLowerCase()));
  const root = await listNodes(mode, appsId);
  const already = new Set(root.filter((n) => n.kind === "folder").map((n) => n.name.toLowerCase()));
  const leftover = await listNodes(mode, null);
  for (const n of leftover) {
    if (n.kind !== "folder") continue;
    if (n.id === appsId || n.name === APPS_FOLDER_NAME) continue;
    if (!names.has(n.name.toLowerCase())) continue;
    if (already.has(n.name.toLowerCase())) continue;
    await moveNode(mode, n.id, appsId);
    already.add(n.name.toLowerCase());
  }
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

async function appLeaf(mode: StoreMode, app: string, leaf: string) {
  const folderId = await ensureAppFolder(mode, app);
  const kids = await listNodes(mode, folderId);
  const found = kids.find((n) => n.kind === "folder" && n.name === leaf);
  if (found) return found.id;
  return mkdirId(mode, folderId, leaf);
}

export async function saveAppBackup(mode: StoreMode, app: string, payload: string) {
  const folderId = await appLeaf(mode, app, "Backups");
  const stamp = new Date();
  const slug = app.toLowerCase().replace(/\s+/g, "-");
  const name = `${slug}-${stamp.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  const file = new File([payload], name, { type: "application/json" });
  await putFiles(mode, folderId, [file]);
  return { name, folderId };
}

export async function listAppBackups(mode: StoreMode, app: string) {
  const folderId = await appLeaf(mode, app, "Backups");
  const files = (await listNodes(mode, folderId)).filter((n) => n.kind === "file");
  files.sort((a, b) => b.createdAt - a.createdAt);
  return { folderId, files };
}

export async function restoreBackup(mode: StoreMode, id: string, device: string) {
  const file = await getFile(mode, id);
  if (!file) throw new Error("Backup not found");
  const preview = new TextDecoder().decode(file.bytes);
  const rec: RestoreRecord = {
    id: crypto.randomUUID(),
    fileName: file.name,
    deviceKind: device,
    restoredAt: new Date().toISOString(),
  };
  localStorage.setItem(RESTORE_KEY, JSON.stringify(rec));
  return { ...rec, preview };
}

export function lastRestore(): RestoreRecord | null {
  try {
    const raw = localStorage.getItem(RESTORE_KEY);
    return raw ? (JSON.parse(raw) as RestoreRecord) : null;
  } catch {
    return null;
  }
}

export async function ensureAppFolder(mode: StoreMode, name: string) {
  const appsId = await ensureAppsRoot(mode);
  const kids = await listNodes(mode, appsId);
  const found = kids.find((n) => n.kind === "folder" && n.name === name);
  if (found) return found.id;
  const leftover = (await listNodes(mode, null)).find((n) => n.kind === "folder" && n.name === name && n.id !== appsId);
  if (leftover) {
    await moveNode(mode, leftover.id, appsId);
    return leftover.id;
  }
  return mkdirId(mode, appsId, name);
}

export async function connectedApps(mode: StoreMode): Promise<ConnectedApp[]> {
  await ensurePotion(mode);
  const names = registry.listAppNames();
  const appsId = await ensureAppsRoot(mode);
  const kids = await listNodes(mode, appsId);
  const out: ConnectedApp[] = [];
  for (const name of names) {
    const found = kids.find((n) => n.kind === "folder" && n.name === name);
    let count = 0;
    if (found) {
      const nested = await listNodes(mode, found.id);
      count = nested.filter((n) => n.kind === "file").length;
      for (const n of nested.filter((x) => x.kind === "folder")) {
        count += (await listNodes(mode, n.id)).filter((f) => f.kind === "file").length;
      }
    }
    out.push({ id: found?.id ?? name, name, folderId: found?.id ?? "", files: count });
  }
  return out;
}

export async function addConnectedApp(mode: StoreMode, name: string) {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (RESERVED_APP_NAMES.has(trimmed.toLowerCase())) {
    throw new Error("That name is reserved for Potion itself");
  }
  const added = registry.addAppName(trimmed);
  const folderId = await ensureAppFolder(mode, added);
  return { name: added, folderId };
}

export async function removeConnectedApp(name: string) {
  registry.removeAppName(name);
}
