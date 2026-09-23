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

/** Signed-in devices hold a live stream. A slow poll is only the fallback. */
export function subscribeCloud(fn: () => void) {
  let es: EventSource | null = null;
  let poll = 0;
  let stopped = false;
  let bearer = "";
  try {
    bearer = sessionStorage.getItem("grok-auth.bearer-token") || "";
  } catch {
    bearer = "";
  }
  const q = bearer ? `?bearer=${encodeURIComponent(bearer)}` : "";
  try {
    es = new EventSource(`/api/potion-live${q}`);
    es.onmessage = () => fn();
    es.onerror = () => {
      es?.close();
      if (stopped || poll) return;
      poll = window.setInterval(fn, 20000);
    };
  } catch {
    poll = window.setInterval(fn, 20000);
  }
  return () => {
    stopped = true;
    es?.close();
    if (poll) window.clearInterval(poll);
  };
}
