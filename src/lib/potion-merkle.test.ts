import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LEAF, dirtyLeaves, folderRoot, reusedLeaves, treeLevels, walkDirty } from "./potion-merkle.ts";

describe("merkle tree", () => {
  it("finds the one leaf that changed", async () => {
    const local = await treeLevels(["aa", "bb", "cc", "dd"]);
    const remote = await treeLevels(["aa", "bb", "cc", "ee"]);
    assert.deepEqual(dirtyLeaves(local, remote), [3]);
    const walked = await walkDirty(local, async (depth, nodes) => ({
      known: true,
      width: remote[depth].length,
      same: nodes.map((n) => remote[depth][n.index] === n.hash),
    }));
    assert.deepEqual(walked, [3]);
  });

  it("stops at the root when the tree matches", async () => {
    const levels = await treeLevels(["aa", "bb", "cc", "dd"]);
    let calls = 0;
    const dirty = await walkDirty(levels, async (depth, nodes) => {
      calls += 1;
      return { known: true, width: levels[depth].length, same: nodes.map(() => true) };
    });
    assert.deepEqual(dirty, []);
    assert.equal(calls, 1);
  });

  it("folder root follows the children", async () => {
    const same = await folderRoot([{ name: "a", kind: "file", hash: "h" }]);
    const again = await folderRoot([{ name: "a", kind: "file", hash: "h" }]);
    const changed = await folderRoot([{ name: "a", kind: "file", hash: "h2" }]);
    assert.equal(same, again);
    assert.notEqual(same, changed);
  });

  it("rehash keeps the untouched prefix", async () => {
    const blob = new Blob([new Uint8Array(LEAF + 4)]);
    const full = await reusedLeaves(blob, null, 0);
    const again = await reusedLeaves(blob, full, LEAF);
    assert.equal(again[0], full[0]);
    assert.equal(again.length, full.length);
  });
});
