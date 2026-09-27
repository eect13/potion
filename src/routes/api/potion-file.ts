import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { blobFilePath } from "@/lib/potion-blob-server";
import { resolveShare } from "@/lib/potion-cloud";
import { userForTicket } from "@/lib/potion-ticket.server";

export const Route = createFileRoute("/api/potion-file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id") || "";
        const version = Number(url.searchParams.get("version") || "0");
        const token = url.searchParams.get("token");
        const ticket = url.searchParams.get("ticket");
        const sql = await getSql();
        let userId = "";
        if (token) {
          const share = await resolveShare(token, id);
          if (!share) return new Response("Gone", { status: 404 });
          userId = share.userId;
        } else if (ticket) {
          const fromTicket = userForTicket(ticket);
          if (!fromTicket) return new Response("Unauthorized", { status: 401 });
          userId = fromTicket;
          const owned = await sql<{ id: string }>`
            select id from potion_nodes where id = ${id} and user_id = ${userId} and deleted_at is null limit 1`;
          if (!owned[0]) return new Response("Gone", { status: 404 });
        } else {
          userId = await requireUserId(url.searchParams.get("bearer") || undefined);
          const owned = await sql<{ id: string }>`
            select id from potion_nodes where id = ${id} and user_id = ${userId} and deleted_at is null limit 1`;
          if (!owned[0]) return new Response("Gone", { status: 404 });
        }
        const meta = await sql<{ mime: string | null; version: number }>`
          select mime, version from potion_nodes where id = ${id} limit 1`;
        const ver = version || Number(meta[0]?.version) || 1;
        const path = blobFilePath(userId, id, ver);
        let size = 0;
        try {
          size = (await stat(path)).size;
        } catch {
          return new Response("Gone", { status: 404 });
        }
        const mime = meta[0]?.mime || "application/octet-stream";
        const range = request.headers.get("range");
        if (range) {
          const match = /bytes=(\d+)-(\d*)/.exec(range);
          const start = match ? Number(match[1]) : 0;
          const end = match && match[2] ? Number(match[2]) : size - 1;
          if (start > end || start >= size) return new Response("Range", { status: 416 });
          const stream = createReadStream(path, { start, end });
          return new Response(Readable.toWeb(stream) as ReadableStream, {
            status: 206,
            headers: {
              "Content-Type": mime,
              "Accept-Ranges": "bytes",
              "Content-Range": `bytes ${start}-${end}/${size}`,
              "Content-Length": String(end - start + 1),
            },
          });
        }
        return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
          headers: {
            "Content-Type": mime,
            "Accept-Ranges": "bytes",
            "Content-Length": String(size),
          },
        });
      },
    },
  },
});
