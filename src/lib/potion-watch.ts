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
  let poll = 0;
  let stopped = false;
  const ac = new AbortController();
  const headers: Record<string, string> = { accept: "text/event-stream" };
  try {
    const bearer = sessionStorage.getItem("grok-auth.bearer-token") || "";
    if (bearer) headers.authorization = `Bearer ${bearer}`;
  } catch {
    /* ignore */
  }
  void (async () => {
    try {
      const res = await fetch("/api/potion-live", { headers, signal: ac.signal });
      if (!res.ok || !res.body) throw new Error("live");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        if (!buf.includes("data:")) continue;
        buf = "";
        fn();
      }
    } catch {
      if (stopped || poll) return;
      poll = window.setInterval(fn, 20000);
    }
  })();
  return () => {
    stopped = true;
    ac.abort();
    if (poll) window.clearInterval(poll);
  };
}
