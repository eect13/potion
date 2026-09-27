import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyFolderRoots, planSync, type SyncEntry, type SyncNode } from "./potion-pair.ts";

function entry(node: SyncNode, path: string): SyncEntry {
  const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return { node, path, parentPath };
}

function file(p: Partial<SyncNode> & { id: string; name: string }): SyncNode {
  return {
    parentId: null,
    kind: "file",
    mime: "application/octet-stream",
    size: 4,
    hash: "h",
    updatedAt: 1,
    peerId: null,
    ...p,
  };
}

describe("planSync", () => {
  it("renames by id instead of uploading a second copy", () => {
    const local = [
      entry(file({ id: "l1", name: "b.txt", peerId: "c1", hash: "h", updatedAt: 20 }), "b.txt"),
    ];
    const remote = [entry(file({ id: "c1", name: "a.txt", hash: "h", updatedAt: 10 }), "a.txt")];
    const marks = { c1: { ident: "/a.txt", hash: "h", conflict: null } };
    const actions = planSync(local, remote, { "id:c1": { hash: "h", conflict: null } }, marks);
    assert.equal(actions.some((a) => a.action === "upload" || a.action === "download"), false);
    const place = actions.find((a) => a.action === "place");
    assert.equal(place && place.action === "place" ? place.side : "", "cloud");
    assert.equal(place && place.action === "place" ? place.name : "", "b.txt");
  });

  it("adopts a cloud rename when this device still has the old name", () => {
    const local = [entry(file({ id: "l1", name: "a.txt", peerId: "c1", hash: "h", updatedAt: 10 }), "a.txt")];
    const remote = [entry(file({ id: "c1", name: "b.txt", hash: "h", updatedAt: 30 }), "b.txt")];
    const marks = { c1: { ident: "/a.txt", hash: "h", conflict: null } };
    const actions = planSync(local, remote, { "id:c1": { hash: "h", conflict: null } }, marks);
    const place = actions.find((a) => a.action === "place");
    assert.equal(place && place.action === "place" ? place.side : "", "local");
    assert.equal(actions.some((a) => a.action === "upload" || a.action === "download"), false);
  });

  it("does not re-copy a file when only its folder was renamed", () => {
    const local = [
      entry(
        { id: "lf", parentId: null, name: "Pictures", kind: "folder", mime: null, size: 0, hash: null, updatedAt: 20, peerId: "cf" },
        "Pictures",
      ),
      entry(file({ id: "l1", parentId: "lf", name: "a.jpg", peerId: "c1", hash: "h", updatedAt: 20 }), "Pictures/a.jpg"),
    ];
    const remote = [
      entry(
        { id: "cf", parentId: null, name: "Photos", kind: "folder", mime: null, size: 0, hash: null, updatedAt: 10, peerId: null },
        "Photos",
      ),
      entry(file({ id: "c1", parentId: "cf", name: "a.jpg", hash: "h", updatedAt: 10 }), "Photos/a.jpg"),
    ];
    const marks = {
      cf: { ident: "/Photos", hash: null, conflict: null },
      c1: { ident: "cf/a.jpg", hash: "h", conflict: null },
    };
    const actions = planSync(local, remote, { "id:c1": { hash: "h", conflict: null } }, marks);
    assert.equal(actions.filter((a) => a.action === "upload" || a.action === "download").length, 0);
    assert.equal(actions.filter((a) => a.action === "place").length, 1);
    const place = actions.find((a) => a.action === "place" && a.cloudId === "cf");
    assert.equal(place && place.action === "place" ? place.name : "", "Pictures");
  });

  it("creates an empty folder on the other side", () => {
    const local = [
      entry(
        { id: "lf", parentId: null, name: "Notes", kind: "folder", mime: null, size: 0, hash: null, updatedAt: 5, peerId: null },
        "Notes",
      ),
    ];
    const made = planSync(local, [], {}, {});
    assert.equal(made[0]?.action, "mkdir");
    assert.equal(made[0] && made[0].action === "mkdir" ? made[0].side : "", "cloud");
    const remote = [
      entry(
        { id: "cf", parentId: null, name: "Notes", kind: "folder", mime: null, size: 0, hash: null, updatedAt: 5, peerId: null },
        "Notes",
      ),
    ];
    const back = planSync([], remote, {}, {});
    assert.equal(back[0] && back[0].action === "mkdir" ? back[0].side : "", "local");
  });

  it("uploads a changed file onto the same cloud id", () => {
    const local = [entry(file({ id: "l1", name: "a.txt", peerId: "c1", hash: "new", updatedAt: 5 }), "a.txt")];
    const remote = [entry(file({ id: "c1", name: "a.txt", hash: "old", updatedAt: 1 }), "a.txt")];
    const actions = planSync(
      local,
      remote,
      { "id:c1": { hash: "old", conflict: null } },
      { c1: { ident: "/a.txt", hash: "old", conflict: null } },
    );
    const up = actions.find((a) => a.action === "upload");
    assert.equal(up && up.action === "upload" ? up.remoteId : "", "c1");
    assert.equal(actions.some((a) => a.action === "download"), false);
  });

  it("skips a folder whose root matches", async () => {
    const local = [
      entry(file({ id: "lf", name: "Pics", kind: "folder", hash: null, peerId: "cf", size: 0, mime: null }), "Pics"),
      entry(file({ id: "l1", name: "a.jpg", parentId: "lf", peerId: "c1", hash: "h" }), "Pics/a.jpg"),
    ];
    const remote = [
      entry(file({ id: "cf", name: "Pics", kind: "folder", hash: null, size: 0, mime: null }), "Pics"),
      entry(file({ id: "c1", name: "a.jpg", parentId: "cf", hash: "h" }), "Pics/a.jpg"),
    ];
    const actions = planSync(
      await applyFolderRoots(local),
      await applyFolderRoots(remote),
      { "id:c1": { hash: "h", conflict: null } },
      {
        cf: { ident: "/Pics", hash: null, conflict: null },
        c1: { ident: "cf/a.jpg", hash: "h", conflict: null },
      },
    );
    assert.deepEqual(actions, []);
  });
});
