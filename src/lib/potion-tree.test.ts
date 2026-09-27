import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprint, LEAF, merkleRoot, sha256 } from "./potion-merkle.ts";
import { fingerprintFile } from "./potion-blob-server.ts";
import { jobKey } from "./potion-resume.ts";
import { nodeUnder } from "./potion-tree.ts";

describe("nodeUnder", () => {
  const parents = new Map<string, string | null>([
    ["root", null],
    ["child", "root"],
    ["grand", "child"],
    ["other", null],
  ]);
  const parentOf = (id: string) => parents.get(id) ?? null;

  it("covers the shared folder and files nested inside it", () => {
    assert.equal(nodeUnder("root", "root", parentOf), true);
    assert.equal(nodeUnder("root", "child", parentOf), true);
    assert.equal(nodeUnder("root", "grand", parentOf), true);
    assert.equal(nodeUnder("root", "other", parentOf), false);
  });

  it("stops if parents cycle", () => {
    const parentOfCycle = (id: string) => (id === "a" ? "b" : "a");
    assert.equal(nodeUnder("missing", "a", parentOfCycle), false);
  });
});

describe("resume key", () => {
  it("is the folder plus the name, not the file hash", () => {
    assert.equal(jobKey(null, "a.txt"), "/a.txt");
    assert.notEqual(jobKey("p1", "a.txt"), jobKey("p2", "a.txt"));
    assert.notEqual(jobKey("p1", "a.txt"), jobKey("p1", "b.txt"));
  });
});

describe("merkle", () => {
  it("root is the hash of the leaf hashes, and the server agrees", async () => {
    const head = new Uint8Array(LEAF);
    head.fill(7);
    const tail = new Uint8Array([1, 2, 3, 4]);
    const leaves = [await sha256(head), await sha256(tail)];
    const root = await merkleRoot(leaves, LEAF + tail.length);
    assert.equal(await fingerprint(new Blob([head, tail])), root);

    const dir = await mkdtemp(join(tmpdir(), "potion-merkle-"));
    const path = join(dir, "f.bin");
    const raw = Buffer.concat([Buffer.from(head), Buffer.from(tail)]);
    await writeFile(path, raw);
    try {
      assert.equal(await fingerprintFile(path), root);
      assert.equal(await fingerprintFile(join(dir, "missing.bin")), await merkleRoot([], 0));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
