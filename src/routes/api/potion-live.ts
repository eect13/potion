import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { onLive } from "@/lib/potion-live.server";

export const Route = createFileRoute("/api/potion-live")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const userId = await requireUserId(url.searchParams.get("bearer") || undefined);
        const encoder = new TextEncoder();
        let closed = false;
        const stream = new ReadableStream({
          start(controller) {
            const send = () => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ at: Date.now() })}\n\n`));
              } catch {
                closed = true;
              }
            };
            send();
            const off = onLive(userId, send);
            let last = "";
            const tick = setInterval(() => {
              void (async () => {
                try {
                  const sql = await getSql();
                  const rows = await sql<{ at: string | null }>`
                    select max(updated_at)::text as at from potion_nodes where user_id = ${userId}`;
                  const notes = await sql<{ at: string | null }>`
                    select max(created_at)::text as at from potion_comments where user_id = ${userId}`;
                  const at = `${rows[0]?.at || ""}|${notes[0]?.at || ""}`;
                  if (last && at !== last) send();
                  last = at;
                } catch {
                  /* keep the stream */
                }
              })();
            }, 1000);
            const ping = setInterval(() => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(`: ping\n\n`));
              } catch {
                closed = true;
              }
            }, 15000);
            const stop = () => {
              if (closed) return;
              closed = true;
              clearInterval(tick);
              clearInterval(ping);
              off();
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            };
            request.signal.addEventListener("abort", stop);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
