export type PlanNode = { hash: string | null } | null | undefined;
export type BaseMark = { hash: string | null; conflict: string | null } | null | undefined;
export type SyncPlan = "skip" | "upload" | "download" | "conflict" | "agree";

export function planFile(local: PlanNode, remote: PlanNode, base: BaseMark): SyncPlan {
  const lh = local?.hash || null;
  const rh = remote?.hash || null;
  if (!lh && !rh) return "skip";
  if (!lh && rh) return "download";
  if (lh && !rh) return "upload";
  if (lh === rh) return "agree";
  if (base?.hash && rh === base.hash) return "upload";
  if (base?.hash && lh === base.hash) return "download";
  const pair = `${lh}|${rh}`;
  if (base?.conflict === pair) return "skip";
  return "conflict";
}

export function pairOf(localHash: string | null, remoteHash: string | null) {
  return `${localHash || ""}|${remoteHash || ""}`;
}
