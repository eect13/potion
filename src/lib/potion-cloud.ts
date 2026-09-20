import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

export type CloudNode = {
  id: string;
  parentId: string | null;
  name: string;
  kind: "file" | "folder";
  mime: string | null;
  size: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  hash: string | null;
  synced: boolean;
};

type NodeRow = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: string;
  mime: string | null;
  size: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  synced?: boolean;
};

function nid() {
  return crypto.randomUUID();
}

function toB64(s: string) {
  return btoa(unescape(encodeURIComponent(s)));
}

function fromB64(s: string) {
  return decodeURIComponent(escape(atob(s)));
}

function mapNode(r: NodeRow): CloudNode {
  return {
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    kind: r.kind === "folder" ? "folder" : "file",
    mime: r.mime,
    size: Number(r.size) || 0,
    version: Number(r.version) || 1,
    createdAt: Date.parse(r.created_at) || Date.now(),
    updatedAt: Date.parse(r.updated_at) || Date.now(),
    deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : null,
    hash: null,
    synced: r.synced !== false,
  };
}

export const ensureCloud = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const apps = await sql<{ id: string }>`
      select id from potion_nodes
      where user_id = ${context.userId} and parent_id is null and name = 'Apps'
        and kind = 'folder' and deleted_at is null
      limit 1`;
    if (apps[0]) {
      const kids = await sql<{ name: string }>`
        select name from potion_nodes
        where user_id = ${context.userId} and parent_id = ${apps[0].id} and deleted_at is null`;
      const leftover =
        kids.length === 0 ||
        kids.some((k) => ["Finance Manager", "Atrium", "Font Manager"].includes(k.name));
      if (leftover) {
        await sql`
          update potion_nodes set parent_id = null, updated_at = now()
          where user_id = ${context.userId} and parent_id = ${apps[0].id} and deleted_at is null`;
        await sql`
          update potion_nodes set deleted_at = now(), updated_at = now()
          where id = ${apps[0].id} and user_id = ${context.userId}`;
      }
    }
    return { ok: true as const };
  });

export const listCloud = createServerFn({ method: "GET" })
  .validator((parentId: string | null) => parentId)
  .middleware([authMiddleware])
  .handler(async ({ context, data: parentId }) => {
    const sql = await getSql();
    const rows: NodeRow[] = parentId
      ? await sql<NodeRow>`
          select id, parent_id, name, kind, mime, size, version, created_at, updated_at, deleted_at, synced
          from potion_nodes
          where user_id = ${context.userId} and parent_id = ${parentId} and deleted_at is null
          order by kind desc, name asc`
      : await sql<NodeRow>`
          select id, parent_id, name, kind, mime, size, version, created_at, updated_at, deleted_at, synced
          from potion_nodes
          where user_id = ${context.userId} and parent_id is null and deleted_at is null
          order by kind desc, name asc`;
    return rows.map(mapNode);
  });

export const pathCloud = createServerFn({ method: "GET" })
  .validator((id: string | null) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    if (!id) return [] as CloudNode[];
    const sql = await getSql();
    const crumbs: CloudNode[] = [];
    let cur: string | null = id;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const rows: NodeRow[] = await sql<NodeRow>`
        select id, parent_id, name, kind, mime, size, version, created_at, updated_at, deleted_at, synced
        from potion_nodes where id = ${cur} and user_id = ${context.userId} limit 1`;
      const n = rows[0];
      if (!n) break;
      crumbs.unshift(mapNode(n));
      cur = n.parent_id;
    }
    return crumbs;
  });

export const mkdirCloud = createServerFn({ method: "POST" })
  .validator((d: { parentId: string | null; name: string }) => ({
    parentId: d.parentId,
    name: d.name.trim() || "Untitled",
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const id = nid();
    await sql`
      insert into potion_nodes (id, user_id, parent_id, name, kind, size)
      values (${id}, ${context.userId}, ${data.parentId}, ${data.name}, 'folder', 0)`;
    return { id };
  });

export const putCloud = createServerFn({ method: "POST" })
  .validator((d: { parentId: string | null; name: string; mime: string; content: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    if (data.content.length > 12_000_000) throw new Error("File too large (8 MB).");
    const sql = await getSql();
    const size = Math.floor((data.content.length * 3) / 4);
    const existing = data.parentId
      ? await sql<{ id: string; version: number }>`
          select id, version from potion_nodes
          where user_id = ${context.userId} and parent_id = ${data.parentId}
            and name = ${data.name} and kind = 'file' and deleted_at is null
          limit 1`
      : await sql<{ id: string; version: number }>`
          select id, version from potion_nodes
          where user_id = ${context.userId} and parent_id is null
            and name = ${data.name} and kind = 'file' and deleted_at is null
          limit 1`;
    if (existing[0]) {
      const next = Number(existing[0].version) + 1;
      await sql`
        update potion_nodes
        set content = ${data.content}, mime = ${data.mime}, size = ${size},
            version = ${next}, updated_at = now()
        where id = ${existing[0].id} and user_id = ${context.userId}`;
      return { id: existing[0].id };
    }
    const id = nid();
    await sql`
      insert into potion_nodes (id, user_id, parent_id, name, kind, mime, size, content)
      values (
        ${id}, ${context.userId}, ${data.parentId}, ${data.name}, 'file',
        ${data.mime}, ${size}, ${data.content}
      )`;
    return { id };
  });

export const trashCloud = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`
      update potion_nodes set deleted_at = now(), updated_at = now()
      where user_id = ${context.userId} and (id = ${id} or parent_id = ${id})
        and deleted_at is null`;
    return { ok: true as const };
  });

export const getCloud = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const rows = await sql<{ name: string; mime: string | null; content: string | null; size: number }>`
      select name, mime, content, size from potion_nodes
      where id = ${id} and user_id = ${context.userId} and kind = 'file' and deleted_at is null
      limit 1`;
    const row = rows[0];
    if (!row) return null;
    return { name: row.name, mime: row.mime, content: row.content ?? "", size: Number(row.size) || 0 };
  });

export const copyCloud = createServerFn({ method: "POST" })
  .validator((d: { id: string; destParentId: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    async function unique(parentId: string | null, name: string, skip?: string) {
      const rows = parentId
        ? await sql<{ name: string; id: string }>`
            select id, name from potion_nodes
            where user_id = ${context.userId} and parent_id = ${parentId} and deleted_at is null`
        : await sql<{ name: string; id: string }>`
            select id, name from potion_nodes
            where user_id = ${context.userId} and parent_id is null and deleted_at is null`;
      const taken = new Set(rows.filter((r) => r.id !== skip).map((r) => r.name));
      if (!taken.has(name)) return name;
      const copy = `Copy of ${name}`;
      if (!taken.has(copy)) return copy;
      let i = 2;
      while (taken.has(`Copy of ${name} (${i})`)) i += 1;
      return `Copy of ${name} (${i})`;
    }
    async function clone(id: string, dest: string | null): Promise<string> {
      const rows = await sql<{
        name: string;
        kind: string;
        mime: string | null;
        size: number;
        content: string | null;
        synced: boolean;
      }>`
        select name, kind, mime, size, content, synced from potion_nodes
        where id = ${id} and user_id = ${context.userId} and deleted_at is null limit 1`;
      const src = rows[0];
      if (!src) throw new Error("Missing");
      const name = await unique(dest, src.name);
      const newId = nid();
      await sql`
        insert into potion_nodes (id, user_id, parent_id, name, kind, mime, size, content, synced)
        values (
          ${newId}, ${context.userId}, ${dest}, ${name}, ${src.kind}, ${src.mime}, ${src.size},
          ${src.content}, ${src.synced !== false}
        )`;
      if (src.kind === "folder") {
        const kids = await sql<{ id: string }>`
          select id from potion_nodes
          where user_id = ${context.userId} and parent_id = ${id} and deleted_at is null`;
        for (const k of kids) await clone(k.id, newId);
      }
      return newId;
    }
    return { id: await clone(data.id, data.destParentId) };
  });

export const moveCloud = createServerFn({ method: "POST" })
  .validator((d: { id: string; destParentId: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (data.id === data.destParentId) throw new Error("Can't move a folder into itself");
    let cur = data.destParentId;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      if (cur === data.id) throw new Error("Can't move a folder into itself");
      const rows = await sql<{ parent_id: string | null }>`
        select parent_id from potion_nodes where id = ${cur} and user_id = ${context.userId} limit 1`;
      cur = rows[0]?.parent_id ?? null;
    }
    await sql`
      update potion_nodes set parent_id = ${data.destParentId}, updated_at = now()
      where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const syncCloud = createServerFn({ method: "POST" })
  .validator((d: { id: string; synced: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update potion_nodes set synced = ${data.synced}, updated_at = now()
      where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const shareCloud = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const token = nid().replace(/-/g, "").slice(0, 22);
    await sql`
      insert into potion_shares (token, user_id, node_id)
      values (${token}, ${context.userId}, ${id})`;
    return { token };
  });

export const listTargetsCloud = createServerFn({ method: "GET" })
  .validator((excludeId: string | null) => excludeId)
  .middleware([authMiddleware])
  .handler(async ({ context, data: excludeId }) => {
    const sql = await getSql();
    const rows = await sql<{ id: string; parent_id: string | null; name: string }>`
      select id, parent_id, name from potion_nodes
      where user_id = ${context.userId} and kind = 'folder' and deleted_at is null`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const blocked = new Set<string>();
    if (excludeId) {
      blocked.add(excludeId);
      const walk = (id: string) => {
        for (const r of rows) {
          if (r.parent_id === id && !blocked.has(r.id)) {
            blocked.add(r.id);
            walk(r.id);
          }
        }
      };
      walk(excludeId);
    }
    const pathOf = (id: string) => {
      const parts: string[] = [];
      let cur: string | null = id;
      const guard = new Set<string>();
      while (cur && !guard.has(cur)) {
        guard.add(cur);
        const n = byId.get(cur);
        if (!n) break;
        parts.unshift(n.name);
        cur = n.parent_id;
      }
      return `Potion / ${parts.join(" / ")}`;
    };
    return [
      { id: null as string | null, name: "Potion", path: "Potion" },
      ...rows
        .filter((r) => !blocked.has(r.id))
        .map((r) => ({ id: r.id as string | null, name: r.name, path: pathOf(r.id) })),
    ];
  });

export const renameCloud = createServerFn({ method: "POST" })
  .validator((d: { id: string; name: string }) => ({ id: d.id, name: d.name.trim() || "Untitled" }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update potion_nodes set name = ${data.name}, updated_at = now()
      where id = ${data.id} and user_id = ${context.userId} and deleted_at is null`;
    return { ok: true as const };
  });

export const searchCloud = createServerFn({ method: "GET" })
  .validator((q: string) => q)
  .middleware([authMiddleware])
  .handler(async ({ context, data: q }) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [] as CloudNode[];
    const sql = await getSql();
    const rows = await sql<NodeRow>`
      select id, parent_id, name, kind, mime, size, version, created_at, updated_at, deleted_at, synced
      from potion_nodes
      where user_id = ${context.userId} and deleted_at is null
      order by updated_at desc`;
    return rows.map(mapNode).filter((n) => n.name.toLowerCase().includes(needle)).slice(0, 80);
  });

export const usedBytesCloud = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{ bytes: string | number | null }>`
      select coalesce(sum(size), 0) as bytes from potion_nodes
      where user_id = ${context.userId} and kind = 'file' and deleted_at is null`;
    return { bytes: Number(rows[0]?.bytes) || 0 };
  });

export const listTrashCloud = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<NodeRow>`
      select id, parent_id, name, kind, mime, size, version, created_at, updated_at, deleted_at, synced
      from potion_nodes
      where user_id = ${context.userId} and deleted_at is not null
      order by deleted_at desc`;
    const all = rows.map(mapNode);
    const deleted = new Set(all.map((n) => n.id));
    return all.filter((n) => !n.parentId || !deleted.has(n.parentId));
  });

export const restoreCloud = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const rows = await sql<{ deleted_at: string | null }>`
      select deleted_at from potion_nodes where id = ${id} and user_id = ${context.userId} limit 1`;
    const stamp = rows[0]?.deleted_at;
    if (!stamp) return { ok: true as const };
    await sql`
      update potion_nodes set deleted_at = null, updated_at = now()
      where user_id = ${context.userId} and deleted_at = ${stamp}
        and (id = ${id} or parent_id = ${id})`;
    return { ok: true as const };
  });

export const purgeCloud = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`
      delete from potion_nodes
      where user_id = ${context.userId} and (id = ${id} or parent_id = ${id})`;
    return { ok: true as const };
  });

export const emptyTrashCloud = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await sql`delete from potion_nodes where user_id = ${context.userId} and deleted_at is not null`;
    return { ok: true as const };
  });

export { toB64, fromB64 };
