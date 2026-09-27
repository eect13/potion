/** True when `nodeId` is `rootId` or sits inside it. Stops on a parent cycle. */
export function nodeUnder(rootId: string, nodeId: string, parentOf: (id: string) => string | null | undefined) {
  let cur: string | null | undefined = nodeId;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    if (cur === rootId) return true;
    guard.add(cur);
    cur = parentOf(cur);
  }
  return false;
}
