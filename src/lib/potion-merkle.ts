/** Flat Merkle tree for file bytes.
 *  Each leaf is the SHA-256 of a 1 MB slice. The root is the SHA-256 of
 *  those leaf hex strings plus the byte size. Same bytes always yield the
 *  same root. One flipped slice changes its leaf and the root, so a sync
 *  can see that the file changed without reading the slices that stayed put.
 */

export const LEAF = 1024 * 1024;

function hex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(bytes: BufferSource): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

export async function merkleRoot(leaves: string[], size: number): Promise<string> {
  const joined = new TextEncoder().encode(leaves.join("") + ":" + size);
  return sha256(joined);
}

export async function leafDigests(source: Blob): Promise<string[]> {
  const leaves: string[] = [];
  for (let offset = 0; offset < source.size; offset += LEAF) {
    const slice = source.slice(offset, Math.min(offset + LEAF, source.size));
    leaves.push(await sha256(await slice.arrayBuffer()));
  }
  return leaves;
}

export async function fingerprint(source: Blob): Promise<string> {
  const leaves = await leafDigests(source);
  return merkleRoot(leaves, source.size);
}

/** Keep already-hashed leaves. Only slices from `start` are read again. */
export async function reusedLeaves(source: Blob, prev: string[] | null, start = 0): Promise<string[]> {
  const from = start > 0 ? start - (start % LEAF) : 0;
  const keep = Math.floor(from / LEAF);
  if (!prev || from <= 0 || prev.length < keep) return leafDigests(source);
  const leaves = prev.slice(0, keep);
  for (let offset = from; offset < source.size; offset += LEAF) {
    const slice = source.slice(offset, Math.min(offset + LEAF, source.size));
    leaves.push(await sha256(await slice.arrayBuffer()));
  }
  return leaves;
}

export async function hashFile(source: Blob, prev: string[] | null, start = 0) {
  const leaves = await reusedLeaves(source, prev, start);
  return { leaves, hash: await merkleRoot(leaves, source.size) };
}

/** Binary tree over the flat leaves. The file id stays `merkleRoot`.
 *  Level 0 is the root. A missing right sibling is promoted as itself.
 */
export async function treeLevels(leaves: string[]): Promise<string[][]> {
  if (!leaves.length) return [[await sha256(new TextEncoder().encode(""))]];
  const built: string[][] = [];
  let level = leaves.slice();
  for (;;) {
    built.push(level);
    if (level.length === 1) break;
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) next.push(level[i]);
      else next.push(await sha256(new TextEncoder().encode(`${level[i]}:${level[i + 1]}`)));
    }
    level = next;
  }
  built.reverse();
  return built;
}

export type ProbeLevel = { known: boolean; width: number; same: boolean[] };

/** Leaf indexes whose branch differs. Null means the shapes differ — send the whole list. */
export async function walkDirty(
  levels: string[][],
  probe: (depth: number, nodes: { index: number; hash: string }[]) => Promise<ProbeLevel>,
): Promise<number[] | null> {
  if (!levels.length) return [];
  let frontier = [0];
  for (let depth = 0; depth < levels.length; depth++) {
    const level = levels[depth];
    const nodes = frontier.filter((i) => i < level.length).map((index) => ({ index, hash: level[index] }));
    if (nodes.length > 8192) return null;
    let res: ProbeLevel;
    try {
      res = await probe(depth, nodes);
    } catch {
      return null;
    }
    if (!res.known) return null;
    if (res.width > level.length) return null;
    const dirty: number[] = [];
    for (let k = 0; k < nodes.length; k++) if (!res.same[k]) dirty.push(nodes[k].index);
    if (depth === levels.length - 1) return dirty;
    const nextLen = levels[depth + 1]?.length ?? 0;
    const kids: number[] = [];
    for (const i of dirty) {
      const left = i * 2;
      const right = left + 1;
      if (left < nextLen) kids.push(left);
      if (right < nextLen) kids.push(right);
    }
    if (!kids.length) return dirty.length ? null : [];
    frontier = kids;
  }
  return [];
}

export function dirtyLeaves(local: string[][], remote: string[][]): number[] {
  if (!local.length || !remote.length) return [];
  if (local.length !== remote.length) {
    const n = Math.max(local[local.length - 1].length, remote[remote.length - 1].length);
    return Array.from({ length: n }, (_, i) => i);
  }
  const last = local.length - 1;
  const out: number[] = [];
  const walk = (d: number, i: number) => {
    const lh = local[d]?.[i];
    const rh = remote[d]?.[i];
    if (lh !== undefined && lh === rh) return;
    if (d === last) {
      out.push(i);
      return;
    }
    walk(d + 1, i * 2);
    const right = i * 2 + 1;
    if (local[d + 1]?.[right] !== undefined || remote[d + 1]?.[right] !== undefined) walk(d + 1, right);
  };
  walk(0, 0);
  return out;
}

/** Folder root. Same children, names, and file roots → same hash. */
export async function folderRoot(kids: { name: string; kind: string; hash: string | null }[]): Promise<string> {
  const lines = kids.map((k) => `${k.kind}\0${k.name}\0${k.hash ?? ""}`).sort();
  return sha256(new TextEncoder().encode(lines.join("\n")));
}

