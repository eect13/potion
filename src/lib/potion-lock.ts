/** One window at a time. Web Locks die with the tab, unlike a stuck localStorage flag. */

export async function withPotionLock<T>(name: string, run: () => Promise<T>): Promise<T | "busy"> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return run();
  return locks.request(`potion:${name}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return "busy" as const;
    return run();
  });
}
