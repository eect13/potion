import * as api from "@/lib/potion-api";
import type { PotionNode, StoreMode } from "@/lib/potion-api";

export type SyncStatus = "idle" | "running" | "paused" | "stopped" | "error";

export type SyncState = {
  status: SyncStatus;
  progress: number;
  done: number;
  total: number;
  current: string;
  error: string | null;
};

type Listener = (s: SyncState) => void;

const listeners = new Set<Listener>();
let timer: number | null = null;
let queue: PotionNode[] = [];
let mode: StoreMode = "local";

let state: SyncState = {
  status: "idle",
  progress: 0,
  done: 0,
  total: 0,
  current: "Idle",
  error: null,
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

async function collect(parentId: string | null): Promise<PotionNode[]> {
  const kids = await api.listNodes(mode, parentId);
  const out: PotionNode[] = [];
  for (const k of kids) {
    if (k.kind === "folder") {
      if (k.synced === false) continue;
      out.push(k);
      out.push(...(await collect(k.id)));
    } else {
      out.push(k);
    }
  }
  return out;
}

function clearTimer() {
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function step() {
  if (state.status !== "running") return;
  if (state.done >= state.total) {
    state = { ...state, status: "idle", progress: 100, current: "Caught up", error: null };
    clearTimer();
    emit();
    return;
  }
  const node = queue[state.done];
  const done = state.done + 1;
  state = {
    ...state,
    done,
    progress: state.total ? Math.round((done / state.total) * 100) : 100,
    current: node ? node.name : "Catching up",
    error: null,
  };
  emit();
}

export async function startSync(nextMode: StoreMode) {
  if (state.status === "running") return;
  mode = nextMode;
  try {
    if (state.status !== "paused") {
      queue = await collect(null);
      state = {
        status: "running",
        progress: 0,
        done: 0,
        total: queue.length,
        current: queue[0]?.name ?? "Nothing to sync",
        error: null,
      };
    } else {
      state = { ...state, status: "running", error: null };
    }
    emit();
    clearTimer();
    if (state.total === 0) {
      state = { ...state, status: "idle", progress: 100, current: "Nothing to sync" };
      emit();
      return;
    }
    timer = window.setInterval(step, 280);
  } catch (err) {
    state = {
      ...state,
      status: "error",
      error: err instanceof Error ? err.message : "Sync failed",
      current: "Stopped on error",
    };
    clearTimer();
    emit();
  }
}

export function pauseSync() {
  if (state.status !== "running") return;
  clearTimer();
  state = { ...state, status: "paused", current: state.current ? `Paused · ${state.current}` : "Paused" };
  emit();
}

export function stopSync() {
  clearTimer();
  queue = [];
  state = { status: "stopped", progress: 0, done: 0, total: 0, current: "Stopped", error: null };
  emit();
}

export async function retrySync(nextMode: StoreMode) {
  stopSync();
  await startSync(nextMode);
}
