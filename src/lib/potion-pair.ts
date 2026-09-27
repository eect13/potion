import { planFile } from "./potion-plan.ts";
import { folderRoot } from "./potion-merkle.ts";

/** Pair local and cloud nodes by id, not by path.
 *  A rename or move keeps the same id, so the old path is not uploaded again.
 */

export type SyncNode = {
  id: string;
  parentId: string | null;
  name: string;
  kind: "file" | "folder";
  mime: string | null;
  size: number;
  hash: string | null;
  updatedAt: number;
  peerId?: string | null;
};

export type SyncEntry = {
  node: SyncNode;
  path: string;
  parentPath: string;
};

export type HashBase = { hash: string | null; conflict: string | null };
export type IdentMark = { ident: string; hash: string | null; conflict: string | null };

export type PlanAction = {
  drop: string[];
} & (
  | { action: "link"; localId: string; cloudId: string }
  | { action: "mkdir"; side: "local" | "cloud"; parentPath: string; name: string; path: string; localId?: string; remoteId?: string }
  | { action: "place"; side: "local" | "cloud"; id: string; localId: string; cloudId: string; parentPath: string; name: string; path: string; phase: "early" | "late" }
  | { action: "upload"; path: string; parentPath: string; name: string; mime: string | null; size: number; localId: string; remoteId?: string; hash: string | null }
  | { action: "download"; path: string; parentPath: string; name: string; mime: string | null; size: number; remoteId: string; remoteParentId: string | null; localId?: string; hash: string | null }
  | { action: "conflict"; path: string; parentPath: string; name: string; mime: string | null; size: number; localId: string; remoteId: string; hash: string | null; remoteHash: string | null }
  | { action: "note"; path: string; cloudId: string; localId: string; hash: string | null; conflict: string | null }
);

function parentKey(entry: SyncEntry, localToCloud: Map<string, string>) {
  if (!entry.node.parentId) return "";
  return localToCloud.get(entry.node.parentId) ?? `local:${entry.node.parentId}`;
}

function ident(parent: string, name: string) {
  return `${parent}/${name}`;
}

type Decision = "same" | "keep-local" | "keep-remote";

function decide(local: SyncEntry, remote: SyncEntry, localToCloud: Map<string, string>, seen: string | null): Decision {
  const localIdent = ident(parentKey(local, localToCloud), local.node.name);
  const remoteIdent = ident(remote.node.parentId ?? "", remote.node.name);
  if (localIdent === remoteIdent) return "same";
  if (seen && seen === localIdent) return "keep-remote";
  if (seen && seen === remoteIdent) return "keep-local";
  if (!seen) return local.node.updatedAt >= remote.node.updatedAt ? "keep-local" : "keep-remote";
  return "keep-local";
}

function agreedIdent(decision: Decision, local: SyncEntry, remote: SyncEntry, localToCloud: Map<string, string>) {
  if (decision === "keep-remote") return ident(remote.node.parentId ?? "", remote.node.name);
  return ident(parentKey(local, localToCloud), local.node.name);
}

function chain(entry: SyncEntry, byId: Map<string, SyncEntry>) {
  const out: SyncEntry[] = [];
  let cur: SyncEntry | undefined = entry;
  const guard = new Set<string>();
  while (cur && !guard.has(cur.node.id)) {
    guard.add(cur.node.id);
    out.unshift(cur);
    cur = cur.node.parentId ? byId.get(cur.node.parentId) : undefined;
  }
  return out;
}

export async function applyFolderRoots(entries: SyncEntry[]): Promise<SyncEntry[]> {
  const byParent = new Map<string | null, SyncEntry[]>();
  for (const e of entries) {
    const list = byParent.get(e.node.parentId) ?? [];
    list.push(e);
    byParent.set(e.node.parentId, list);
  }
  const folderHash = new Map<string, string>();
  const visiting = new Set<string>();
  async function seal(id: string): Promise<string> {
    const known = folderHash.get(id);
    if (known) return known;
    if (visiting.has(id)) return "";
    visiting.add(id);
    const rows: { name: string; kind: string; hash: string | null }[] = [];
    for (const k of byParent.get(id) ?? []) {
      const hash = k.node.kind === "folder" ? await seal(k.node.id) : k.node.hash;
      rows.push({ name: k.node.name, kind: k.node.kind, hash });
    }
    const root = await folderRoot(rows);
    folderHash.set(id, root);
    return root;
  }
  for (const e of entries) {
    if (e.node.kind === "folder") await seal(e.node.id);
  }
  return entries.map((e) =>
    e.node.kind === "folder" ? { ...e, node: { ...e.node, hash: folderHash.get(e.node.id) ?? e.node.hash } } : e,
  );
}

/** One hash for the whole folder. Quiet drives compare this and stop. */
export async function entryRoot(entries: SyncEntry[]): Promise<string> {
  const hashed = await applyFolderRoots(entries);
  const top = hashed.filter((e) => !e.node.parentId);
  return folderRoot(top.map((e) => ({ name: e.node.name, kind: e.node.kind, hash: e.node.hash })));
}

function joined(names: string[]) {
  const name = names[names.length - 1] ?? "";
  const parentPath = names.slice(0, -1).join("/");
  return { name, parentPath, path: parentPath ? `${parentPath}/${name}` : name };
}

function drops(finalPath: string, ...paths: string[]) {
  return [...new Set(paths.filter((p) => p && p !== finalPath))];
}

export function planSync(
  local: SyncEntry[],
  remote: SyncEntry[],
  bases: Record<string, HashBase>,
  marks: Record<string, IdentMark> = {},
): PlanAction[] {
  const remoteById = new Map(remote.map((e) => [e.node.id, e]));
  const localById = new Map(local.map((e) => [e.node.id, e]));
  const usedL = new Set<string>();
  const usedR = new Set<string>();
  const pairs: { local: SyncEntry; remote: SyncEntry; linked: boolean }[] = [];

  for (const l of local) {
    const peer = l.node.peerId;
    if (!peer) continue;
    const r = remoteById.get(peer);
    if (!r || usedR.has(r.node.id) || r.node.kind !== l.node.kind) continue;
    pairs.push({ local: l, remote: r, linked: true });
    usedL.add(l.node.id);
    usedR.add(r.node.id);
  }

  const remoteByPath = new Map<string, SyncEntry>();
  for (const r of remote) {
    if (!usedR.has(r.node.id)) remoteByPath.set(`${r.node.kind}:${r.path}`, r);
  }
  for (const l of local) {
    if (usedL.has(l.node.id)) continue;
    const r = remoteByPath.get(`${l.node.kind}:${l.path}`);
    if (!r || usedR.has(r.node.id)) continue;
    pairs.push({ local: l, remote: r, linked: false });
    usedL.add(l.node.id);
    usedR.add(r.node.id);
  }

  const localToCloud = new Map(pairs.map((p) => [p.local.node.id, p.remote.node.id]));
  const remoteToLocal = new Map(pairs.map((p) => [p.remote.node.id, p.local]));
  const decision = new Map<string, Decision>();
  for (const p of pairs) {
    decision.set(p.local.node.id, decide(p.local, p.remote, localToCloud, marks[p.remote.node.id]?.ident ?? null));
  }

  function buried(localId: string) {
    let parent = localById.get(localId)?.node.parentId ?? null;
    const guard = new Set<string>();
    while (parent && !guard.has(parent)) {
      guard.add(parent);
      const cloud = localToCloud.get(parent);
      const lf = localById.get(parent);
      const rf = cloud ? remoteById.get(cloud) : undefined;
      if (
        lf?.node.kind === "folder" &&
        rf?.node.kind === "folder" &&
        lf.node.hash &&
        lf.node.hash === rf.node.hash &&
        (decision.get(parent) ?? "same") === "same"
      ) {
        return true;
      }
      parent = lf?.node.parentId ?? null;
    }
    return false;
  }

  function localNames(entry: SyncEntry) {
    return chain(entry, localById).map((n) => {
      if (decision.get(n.node.id) === "keep-remote") {
        const r = remoteById.get(localToCloud.get(n.node.id) || "");
        if (r) return r.node.name;
      }
      return n.node.name;
    });
  }

  function remoteNames(entry: SyncEntry) {
    return chain(entry, remoteById).map((n) => {
      const l = remoteToLocal.get(n.node.id);
      if (l && decision.get(l.node.id) === "keep-local") return l.node.name;
      return n.node.name;
    });
  }

  const remoteParentReady = new Set(localToCloud.values());
  const actions: PlanAction[] = [];

  for (const p of pairs) {
    if (!p.linked) actions.push({ action: "link", localId: p.local.node.id, cloudId: p.remote.node.id, drop: [] });
    if (buried(p.local.node.id)) continue;
    const d = decision.get(p.local.node.id) || "same";
    const final = joined(localNames(p.local));
    const agreed = agreedIdent(d, p.local, p.remote, localToCloud);
    const mark = marks[p.remote.node.id];
    const server = bases[`id:${p.remote.node.id}`] || bases[final.path] || bases[p.local.path] || bases[p.remote.path];
    const drop = drops(final.path, p.local.path, p.remote.path);

    if (d !== "same") {
      const destParentPaired =
        d === "keep-remote"
          ? !p.remote.node.parentId || remoteParentReady.has(p.remote.node.parentId)
          : !p.local.node.parentId || localToCloud.has(p.local.node.parentId);
      actions.push({
        action: "place",
        side: d === "keep-remote" ? "local" : "cloud",
        id: d === "keep-remote" ? p.local.node.id : p.remote.node.id,
        localId: p.local.node.id,
        cloudId: p.remote.node.id,
        parentPath: final.parentPath,
        name: final.name,
        path: final.path,
        phase: destParentPaired ? "early" : "late",
        drop,
      });
    }

    if (p.local.node.kind === "folder") {
      if (!mark || mark.ident !== agreed || drop.length) {
        actions.push({
          action: "note",
          path: final.path,
          cloudId: p.remote.node.id,
          localId: p.local.node.id,
          hash: null,
          conflict: null,
          drop: d === "same" ? drop : [],
        });
      }
      continue;
    }

    const plan = planFile(p.local.node, p.remote.node, server);
    if (plan === "upload") {
      actions.push({
        action: "upload",
        path: final.path,
        parentPath: final.parentPath,
        name: final.name,
        mime: p.local.node.mime,
        size: p.local.node.size,
        localId: p.local.node.id,
        remoteId: p.remote.node.id,
        hash: p.local.node.hash,
        drop,
      });
    } else if (plan === "download") {
      actions.push({
        action: "download",
        path: final.path,
        parentPath: final.parentPath,
        name: final.name,
        mime: p.remote.node.mime,
        size: p.remote.node.size,
        remoteId: p.remote.node.id,
        remoteParentId: p.remote.node.parentId,
        localId: p.local.node.id,
        hash: p.remote.node.hash,
        drop,
      });
    } else if (plan === "conflict") {
      actions.push({
        action: "conflict",
        path: final.path,
        parentPath: final.parentPath,
        name: final.name,
        mime: p.local.node.mime,
        size: p.local.node.size,
        localId: p.local.node.id,
        remoteId: p.remote.node.id,
        hash: p.local.node.hash,
        remoteHash: p.remote.node.hash,
        drop,
      });
    } else if (!mark || mark.ident !== agreed || (plan === "agree" && server?.hash !== p.local.node.hash) || (d === "same" && drop.length)) {
      actions.push({
        action: "note",
        path: final.path,
        cloudId: p.remote.node.id,
        localId: p.local.node.id,
        hash: plan === "skip" ? (server?.hash ?? null) : p.local.node.hash,
        conflict: plan === "skip" ? (server?.conflict ?? null) : null,
        drop: d === "same" ? drop : [],
      });
    }
  }

  for (const l of local) {
    if (usedL.has(l.node.id)) continue;
    const final = joined(localNames(l));
    if (l.node.kind === "folder") {
      actions.push({
        action: "mkdir",
        side: "cloud",
        parentPath: final.parentPath,
        name: final.name,
        path: final.path,
        localId: l.node.id,
        drop: [],
      });
    } else if (l.node.hash) {
      actions.push({
        action: "upload",
        path: final.path,
        parentPath: final.parentPath,
        name: final.name,
        mime: l.node.mime,
        size: l.node.size,
        localId: l.node.id,
        hash: l.node.hash,
        drop: [],
      });
    }
  }

  for (const r of remote) {
    if (usedR.has(r.node.id)) continue;
    const final = joined(remoteNames(r));
    if (r.node.kind === "folder") {
      actions.push({
        action: "mkdir",
        side: "local",
        parentPath: final.parentPath,
        name: final.name,
        path: final.path,
        remoteId: r.node.id,
        drop: [],
      });
    } else if (r.node.hash) {
      actions.push({
        action: "download",
        path: final.path,
        parentPath: final.parentPath,
        name: final.name,
        mime: r.node.mime,
        size: r.node.size,
        remoteId: r.node.id,
        remoteParentId: r.node.parentId,
        hash: r.node.hash,
        drop: [],
      });
    }
  }

  const weight = (a: PlanAction) => {
    if (a.action === "link") return 0;
    if (a.action === "place" && a.phase === "early") return 1;
    if (a.action === "mkdir") return 2;
    if (a.action === "place") return 3;
    if (a.action === "note") return 5;
    return 4;
  };
  const depth = (a: PlanAction) => ("path" in a && a.path ? a.path.split("/").filter(Boolean).length : 0);
  actions.sort((a, b) => weight(a) - weight(b) || depth(a) - depth(b));
  return actions;
}
