import * as api from "@/lib/potion-api";
import type { StoreMode, TreeEntry } from "@/lib/potion-api";
import { fileKind } from "@/lib/utils";
import { pairOf } from "@/lib/potion-plan";
import { applyFolderRoots, entryRoot, planSync, type PlanAction, type SyncEntry } from "@/lib/potion-pair";
import { withPotionLock } from "@/lib/potion-lock";

export type SyncStatus = "idle" | "running" | "paused" | "stopped" | "error";

export type SyncState = {
  status: SyncStatus;
  progress: number;
  done: number;
  total: number;
  current: string;
  error: string | null;
  skipped: number;
};

type Job =
  | { action: "index"; label: string }
  | (PlanAction & { label: string });

type Listener = (s: SyncState) => void;

const listeners = new Set<Listener>();
let queue: Job[] = [];
let mode: StoreMode = "local";
let running = false;

let state: SyncState = {
  status: "idle",
  progress: 0,
  done: 0,
  total: 0,
  current: "Idle",
  error: null,
  skipped: 0,
};

function emit() {
  listeners.forEach((fn) => fn(state));
}

export function getSyncState() {
  return state;
}

export function subscribeSync(fn: Listener) {
  listeners.add(fn);
  fn(state);
  return () => {
    listeners.delete(fn);
  };
}

function kindLabel(entry: TreeEntry) {
  if (entry.node.kind === "folder") return "folder";
  return fileKind(entry.node.mime, entry.node.name);
}

function jobsFromTree(tree: TreeEntry[]): Job[] {
  return tree
    .filter((e) => e.node.kind === "file")
    .map((e) => ({
      action: "index" as const,
      label: `Keep ${kindLabel(e)} · ${e.node.name}`,
    }));
}

function toSync(e: TreeEntry): SyncEntry {
  return {
    path: e.path,
    parentPath: e.parentPath,
    node: {
      id: e.node.id,
      parentId: e.node.parentId,
      name: e.node.name,
      kind: e.node.kind,
      mime: e.node.mime,
      size: e.node.size,
      hash: e.node.hash,
      updatedAt: e.node.updatedAt,
      peerId: e.node.peerId ?? null,
    },
  };
}

function labelOf(a: PlanAction) {
  const name = "name" in a && a.name ? a.name : "path" in a && a.path ? a.path.split("/").pop() : "";
  if (a.action === "mkdir") return `Folder · ${name}`;
  if (a.action === "place") return `Rename · ${name}`;
  if (a.action === "upload") return `Upload · ${name}`;
  if (a.action === "download") return `Download · ${name}`;
  if (a.action === "conflict") return `Keep both versions · ${name}`;
  if (a.action === "link") return "Link";
  return name ? `Sync · ${name}` : "Sync";
}

async function buildQueue(nextMode: StoreMode): Promise<Job[]> {
  const localTree = await api.collectTree("local");
  if (nextMode !== "cloud") return jobsFromTree(localTree);
  const localPlain = localTree.map(toSync);
  if (localPlain.every((e) => e.node.peerId)) {
    try {
      const remoteRoot = await api.driveRoot();
      const localRoot = await entryRoot(localPlain);
      if (remoteRoot && remoteRoot === localRoot) return [];
    } catch {
      /* fall through to a full compare */
    }
  }
  let cloudTree: TreeEntry[] = [];
  try {
    cloudTree = await api.collectTree("cloud");
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Could not reach Potion");
  }
  const bases = await api.loadBases().catch(() => ({} as Record<string, { hash: string | null; conflict: string | null }>));
  const marks = await api.loadMarks().catch(() => ({}));
  const local = await applyFolderRoots(localPlain);
  const remote = await applyFolderRoots(cloudTree.map(toSync));
  return planSync(local, remote, bases, marks).map((a) => ({
    ...a,
    label: labelOf(a),
  }));
}

async function remember(localId: string, cloudId: string, path: string, hash: string | null, conflict: string | null) {
  const ident = await api.identFor(localId);
  if (hash !== null || conflict) {
    await api.rememberBase(path, hash, conflict);
    await api.rememberBase(`id:${cloudId}`, hash, conflict);
  }
  if (ident) await api.saveMark(cloudId, { ident, hash, conflict });
}

async function forget(paths: string[], keep: string) {
  for (const p of paths) {
    if (p && p !== keep) await api.forgetBase(p).catch(() => undefined);
  }
}

async function runJob(job: Job) {
  if (job.action === "index") return;
  await forget(job.drop, "path" in job ? job.path : "");
  if (job.action === "link") {
    await api.linkPeer(job.localId, job.cloudId);
    return;
  }
  if (job.action === "mkdir") {
    const parts = job.path.split("/").filter(Boolean);
    if (job.side === "cloud") {
      const id = await api.ensureFolderPath("cloud", parts);
      if (id && job.localId) {
        await api.linkPeer(job.localId, id);
        await remember(job.localId, id, job.path, null, null);
      }
      return;
    }
    const id = await api.ensureFolderPath("local", parts);
    if (id && job.remoteId) {
      await api.linkPeer(id, job.remoteId);
      await remember(id, job.remoteId, job.path, null, null);
    }
    return;
  }
  if (job.action === "place") {
    if (job.side === "cloud") await api.placeCloud(job.cloudId, job.parentPath, job.name);
    else await api.placeLocal(job.localId, job.parentPath, job.name);
    await remember(job.localId, job.cloudId, job.path, null, null);
    return;
  }
  if (job.action === "note") {
    await remember(job.localId, job.cloudId, job.path, job.hash, job.conflict);
    return;
  }
  if (job.action === "conflict") {
    await api.keepBoth(job.localId, job.remoteId);
    await remember(job.localId, job.remoteId, job.path, null, pairOf(job.hash ?? null, job.remoteHash ?? null));
    return;
  }
  if (job.action === "upload") {
    const file = await api.getFile("local", job.localId);
    if (!file) throw new Error(`Missing ${job.name}`);
    const started = await api.putCloudFile(job.parentPath, job.name, file.mime, file.blob, job.remoteId, {
      id: job.localId,
      version: file.version,
    });
    await api.linkPeer(job.localId, started.id);
    await remember(job.localId, started.id, job.path, job.hash, null);
    return;
  }
  const file = await api.getFile("cloud", job.remoteId, job.localId);
  if (!file) throw new Error(`Missing ${job.name}`);
  const saved = await api.putLocalFile(job.parentPath, job.name, file.mime, file.blob);
  if (!saved) throw new Error(`Missing ${job.name}`);
  await api.linkPeer(saved.id, job.remoteId);
  await remember(saved.id, job.remoteId, job.path, job.hash, null);
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (state.status === "running") {
      if (state.done >= state.total) {
        if (state.skipped) {
          state = {
            ...state,
            status: "error",
            progress: 100,
            current: `${state.skipped} file${state.skipped === 1 ? "" : "s"} did not sync`,
          };
        } else {
          state = {
            ...state,
            status: "idle",
            progress: 100,
            current: mode === "cloud" ? "Caught up" : "Caught up on this device",
          };
        }
        emit();
        break;
      }
      const job = queue[state.done];
      state = { ...state, current: job ? job.label : "Catching up", error: null };
      emit();
      if (job) {
        try {
          await runJob(job);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Sync failed";
          state = {
            ...state,
            skipped: state.skipped + 1,
            error: msg,
          };
          emit();
        }
      }
      const done = state.done + 1;
      state = {
        ...state,
        done,
        progress: state.total ? Math.round((done / state.total) * 100) : 100,
      };
      emit();
    }
  } finally {
    running = false;
  }
}

export async function startSync(nextMode: StoreMode) {
  if (state.status === "running") return;
  const held = await withPotionLock("sync", async () => {
    mode = nextMode;
    try {
      if (state.status !== "paused") {
        queue = await buildQueue(mode);
        state = {
          status: "running",
          progress: 0,
          done: 0,
          total: queue.length,
          current: queue[0]?.label ?? (mode === "cloud" ? "Nothing to sync" : "Nothing on this device"),
          error: null,
          skipped: 0,
        };
      } else {
        state = { ...state, status: "running", error: null };
      }
      emit();
      if (state.total === 0) {
        state = {
          ...state,
          status: "idle",
          progress: 100,
          current: mode === "cloud" ? "Your account and this device match" : "Nothing to sync on this device",
        };
        emit();
        return;
      }
      await pump();
    } catch (err) {
      state = {
        ...state,
        status: "error",
        error: err instanceof Error ? err.message : "Sync failed",
        current: "Stopped on error",
      };
      emit();
    }
  });
  if (held === "busy") {
    state = {
      ...state,
      status: "idle",
      current: "Another window is already syncing",
    };
    emit();
    return;
  }
  if (followUp && state.status !== "paused" && state.status !== "stopped") {
    followUp = false;
    void startSync(mode);
  }
}

export function pauseSync() {
  if (state.status !== "running") return;
  state = { ...state, status: "paused", current: state.current ? `Paused · ${state.current}` : "Paused" };
  emit();
}

export function stopSync() {
  queue = [];
  state = {
    status: "stopped",
    progress: 0,
    done: 0,
    total: 0,
    current: "Stopped",
    error: null,
    skipped: 0,
  };
  emit();
}

export async function retrySync(nextMode: StoreMode) {
  stopSync();
  await startSync(nextMode);
}

let followUp = false;

export function maybeAutoSync(nextMode: StoreMode) {
  if (nextMode !== "cloud") return;
  if (state.status === "paused") return;
  if (running || state.status === "running") {
    followUp = true;
    return;
  }
  void startSync(nextMode);
}
