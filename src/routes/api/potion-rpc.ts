import { createFileRoute } from "@tanstack/react-router";
import * as cloud from "@/lib/potion-cloud";

const ops: Record<string, (data: unknown) => Promise<unknown>> = {
  ensureCloud: () => cloud.ensureCloud(),
  listCloud: (data) => cloud.listCloud({ data: data as string | null }),
  listAllCloud: () => cloud.listAllCloud(),
  pathCloud: (data) => cloud.pathCloud({ data: data as string | null }),
  mkdirCloud: (data) => cloud.mkdirCloud({ data: data as { parentId: string | null; name: string } }),
  putCloud: (data) => cloud.putCloud({ data: data as { parentId: string | null; name: string; mime: string; size: number; hash: string } }),
  commitCloud: (data) => cloud.commitCloud({ data: data as { id: string; version: number; hash: string; size: number; mime: string } }),
  trashCloud: (data) => cloud.trashCloud({ data: data as string }),
  getCloud: (data) => cloud.getCloud({ data: data as string }),
  copyCloud: (data) => cloud.copyCloud({ data: data as { id: string; destParentId: string | null } }),
  moveCloud: (data) => cloud.moveCloud({ data: data as { id: string; destParentId: string | null } }),
  syncCloud: (data) => cloud.syncCloud({ data: data as { id: string; synced: boolean } }),
  shareCloud: (data) => cloud.shareCloud({ data: data as string }),
  getSharedCloud: (data) => cloud.getSharedCloud({ data: data as string }),
  getSharedFileCloud: (data) => cloud.getSharedFileCloud({ data: data as { token: string; id: string } }),
  getSharedBlobChunk: (data) =>
    cloud.getSharedBlobChunk({ data: data as { token: string; id: string; version: number; offset: number; length: number } }),
  listTargetsCloud: (data) => cloud.listTargetsCloud({ data: data as string | null }),
  renameCloud: (data) => cloud.renameCloud({ data: data as { id: string; name: string } }),
  searchCloud: (data) => cloud.searchCloud({ data: data as string }),
  usedBytesCloud: () => cloud.usedBytesCloud(),
  listTrashCloud: () => cloud.listTrashCloud(),
  restoreCloud: (data) => cloud.restoreCloud({ data: data as string }),
  purgeCloud: (data) => cloud.purgeCloud({ data: data as string }),
  emptyTrashCloud: () => cloud.emptyTrashCloud(),
  putBlobChunk: (data) => cloud.putBlobChunk({ data: data as { id: string; version: number; offset: number; data: string } }),
  getBlobChunk: (data) => cloud.getBlobChunk({ data: data as { id: string; version: number; offset: number; length: number } }),
  statBlob: (data) => cloud.statBlob({ data: data as { id: string; version: number } }),
  listVersionsCloud: (data) => cloud.listVersionsCloud({ data: data as string }),
  revertCloud: (data) => cloud.revertCloud({ data: data as { id: string; version: number } }),
  listCommentsCloud: (data) => cloud.listCommentsCloud({ data: data as string }),
  addCommentCloud: (data) => cloud.addCommentCloud({ data: data as { id: string; body: string; author?: string | null } }),
  listSharedComments: (data) => cloud.listSharedComments({ data: data as string }),
  addSharedComment: (data) => cloud.addSharedComment({ data: data as { token: string; body: string; author?: string } }),
  listBasesCloud: () => cloud.listBasesCloud(),
  setBaseCloud: (data) => cloud.setBaseCloud({ data: data as { path: string; hash: string | null; conflict: string | null } }),
  beginStashCloud: (data) => cloud.beginStashCloud({ data: data as string }),
  commitStashCloud: (data) =>
    cloud.commitStashCloud({ data: data as { id: string; version: number; hash: string; size: number; mime: string } }),
};

export const Route = createFileRoute("/api/potion-rpc")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { op?: string; data?: unknown };
        const fn = body.op ? ops[body.op] : undefined;
        if (!fn) return Response.json({ error: "Unknown" }, { status: 400 });
        try {
          const result = await fn(body.data);
          return Response.json({ result });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed";
          const status = message === "Unauthorized" ? 401 : 400;
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
