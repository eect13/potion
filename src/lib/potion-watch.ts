const CHANNEL = "potion-watch";
const KEY = "potion-watch-at";

type Msg = { at: number; reason: string };

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function bus() {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(CHANNEL);
  channel.addEventListener("message", () => listeners.forEach((fn) => fn()));
  return channel;
}

export function notifyPotion(reason = "change") {
  const at = Date.now();
  try {
    localStorage.setItem(KEY, String(at));
  } catch {
    /* ignore */
  }
  try {
    bus()?.postMessage({ at, reason } satisfies Msg);
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export function subscribePotion(fn: () => void) {
  bus();
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}
