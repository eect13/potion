import * as db from "@/lib/potion-db";
import type { PotionNode } from "@/lib/potion-db";
import * as cloud from "@/lib/potion-cloud";
import * as registry from "@/lib/potion-apps";

export type { PotionNode };
export type StoreMode = "local" | "cloud";

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

async function namedFolder(parentId: string | null, name: string) {
  const kids = await db.listChildren(parentId);
  const found = kids.find((n) => n.kind === "folder" && n.name === name);
  if (found) return found;
  return db.mkdir(parentId, name);
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

export async function putFiles(mode: StoreMode, parentId: string | null, files: File[]) {
  if (mode === "cloud") {
    for (const f of files) {
      await cloud.putCloud({
        data: {
          parentId,
          name: f.name,
          mime: f.type || "application/octet-stream",
          content: await fileToB64(f),
        },
      });
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

async function appLeaf(mode: StoreMode, app: string, leaf: string) {
  if (mode === "cloud") {
    const r = await cloud.appFolderCloud({ data: { app, leaf } });
    return r.id;
  }
  const folder = await namedFolder(null, app);
  const dest = await namedFolder(folder.id, leaf);
  return dest.id;
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
  const root = await listNodes(mode, null);
  const found = root.find((n) => n.kind === "folder" && n.name === name);
  if (found) return found.id;
  if (mode === "cloud") {
    const made = await cloud.mkdirCloud({ data: { parentId: null, name } });
    return made.id;
  }
  const folder = await namedFolder(null, name);
  return folder.id;
}

export async function connectedApps(mode: StoreMode): Promise<ConnectedApp[]> {
  await ensurePotion(mode);
  const names = registry.listAppNames();
  const root = await listNodes(mode, null);
  const out: ConnectedApp[] = [];
  for (const name of names) {
    const found = root.find((n) => n.kind === "folder" && n.name === name);
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
  const added = registry.addAppName(name);
  const folderId = await ensureAppFolder(mode, added);
  return { name: added, folderId };
}

export async function removeConnectedApp(name: string) {
  registry.removeAppName(name);
}
