import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LEAF, leafDigests } from "./potion-merkle.ts";
import { deleteBlobs, seedLeaves, writeChunk } from "./potion-blob-server.ts";

describe("seedLeaves", () => {
  it("asks only for the leaf that changed", async () => {
    const user = "seedtest";
    const id = "abc123";
    const first = new Uint8Array(LEAF + 8);
    first.fill(1);
    first[LEAF] = 2;
    try {
      await writeChunk(user, id, 1, 0, first);
      const changed = new Uint8Array(first);
      changed[0] = 9;
      const leaves = await leafDigests(new Blob([changed]));
      const missing = await seedLeaves(user, id, 2, leaves, changed.byteLength);
      assert.deepEqual(missing, [0]);
      const same = await leafDigests(new Blob([first]));
      const none = await seedLeaves(user, id, 2, same, first.byteLength);
      assert.deepEqual(none, []);
    } finally {
      await deleteBlobs(user, id);
    }
  });
});
