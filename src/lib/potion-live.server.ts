type Fn = () => void;

const subs = new Map<string, Set<Fn>>();

export function emitLive(userId: string) {
  subs.get(userId)?.forEach((fn) => fn());
}

export function onLive(userId: string, fn: Fn) {
  let set = subs.get(userId);
  if (!set) {
    set = new Set();
    subs.set(userId, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
  };
}
