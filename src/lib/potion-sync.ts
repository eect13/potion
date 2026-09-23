import * as api from "@/lib/potion-api";
import type { StoreMode, TreeEntry } from "@/lib/potion-api";
import { fileKind } from "@/lib/utils";
import { pairOf, planFile } from "@/lib/potion-plan";

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

type Job = {
  action: "index" | "upload" | "download" | "conflict";
  label: string;
  path: string;
  parentPath: string;
  name: string;
  mime: string | null;
  size: number;
  nodeId: string;
  source: StoreMode;
  localId?: string;
  remoteId?: string;
  hash?: string | null;
  remoteHash?: string | null;
};

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

function jobsFromTree(tree: TreeEntry[], action: Job["action"], source: StoreMode): Job[] {
  return tree
    .filter((e) => e.node.kind === "file")
    .map((e) => ({
      action,
      label: `${action === "index" ? "Keep" : action === "upload" ? "Upload" : "Download"} ${kindLabel(e)} · ${e.node.name}`,
      path: e.path,
      parentPath: e.parentPath,
      name: e.node.name,
      mime: e.node.mime,
      size: e.node.size,
      nodeId: e.node.id,
      source,
    }));
}

async function buildQueue(nextMode: StoreMode): Promise<Job[]> {
  const localTree = await api.collectTree("local");
  if (nextMode !== "cloud") {
    return jobsFromTree(localTree, "index", "local");
  }
  let cloudTree: TreeEntry[] = [];
  try {
    cloudTree = await api.collectTree("cloud");
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Could not reach Potion");
  }
  const bases = await api.loadBases().catch(() => ({} as Record<string, { hash: string | null; conflict: string | null }>));
  const localFiles = new Map(localTree.filter((e) => e.node.kind === "file").map((e) => [e.path, e]));
  const cloudFiles = new Map(cloudTree.filter((e) => e.node.kind === "file").map((e) => [e.path, e]));
  const paths = new Set([...localFiles.keys(), ...cloudFiles.keys()]);
  const out: Job[] = [];
  for (const path of paths) {
    const local = localFiles.get(path);
    const remote = cloudFiles.get(path);
    const plan = planFile(local?.node, remote?.node, bases[path]);
    if (plan === "skip") continue;
    if (plan === "agree" && local?.node.hash) {
      void api.rememberBase(path, local.node.hash, null).catch(() => undefined);
      continue;
    }
    if (plan === "upload" && local) {
      out.push({ ...jobsFromTree([local], "upload", "local")[0], hash: local.node.hash });
      continue;
    }
    if (plan === "download" && remote) {
      out.push({ ...jobsFromTree([remote], "download", "cloud")[0], hash: remote.node.hash });
      continue;
    }
    if (plan === "conflict" && local && remote) {
      out.push({
        action: "conflict",
        label: `Keep both versions · ${local.node.name}`,
        path,
        parentPath: local.parentPath,
        name: local.node.name,
        mime: local.node.mime,
        size: local.node.size,
        nodeId: local.node.id,
        source: "local",
        localId: local.node.id,
        remoteId: remote.node.id,
        hash: local.node.hash,
        remoteHash: remote.node.hash,
      });
    }
  }
  return out;
}

async function runJob(job: Job) {
  if (job.action === "index") return;
  if (job.action === "conflict" && job.localId && job.remoteId) {
    await api.keepBoth(job.localId, job.remoteId);
    await api.rememberBase(job.path, null, pairOf(job.hash ?? null, job.remoteHash ?? null));
    return;
  }
  const file = await api.getFile(job.source, job.nodeId);
  if (!file) throw new Error(`Missing ${job.name}`);
  if (job.action === "upload") {
    await api.putCloudFile(job.parentPath, file.name, file.mime, file.blob);
    await api.rememberBase(job.path, job.hash || null, null);
    return;
  }
  await api.putLocalFile(job.parentPath, file.name, file.mime, file.blob);
  await api.rememberBase(job.path, job.hash || null, null);
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (state.status === "running") {
      if (state.done >= state.total) {
        const skip = state.skipped ? ` · ${state.skipped} stayed on this device` : "";
        state = {
          ...state,
          status: "idle",
          progress: 100,
          current: mode === "cloud" ? `Caught up${skip}` : "Caught up on this device",
        };
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
    void pump();
  } catch (err) {
    state = {
      ...state,
      status: "error",
      error: err instanceof Error ? err.message : "Sync failed",
      current: "Stopped on error",
    };
    emit();
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

export function maybeAutoSync(nextMode: StoreMode) {
  if (nextMode !== "cloud") return;
  if (state.status === "running" || state.status === "paused") return;
  void startSync(nextMode);
}
