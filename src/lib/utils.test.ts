import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileExt, fileKind, formatBytes, kindLabel, sortNodes, typeLabel } from "./utils.ts";

describe("file helpers", () => {
  it("reads extensions and kinds", () => {
    assert.equal(fileExt("Photo.JPEG"), ".jpeg");
    assert.equal(fileKind("image/png", "x.bin"), "image");
    assert.equal(fileKind("", "clip.webm"), "video");
    assert.equal(fileKind("", "track.flac"), "audio");
    assert.equal(fileKind("", "notes.pdf"), "pdf");
    assert.equal(fileKind("", "pack.7z"), "zip");
    assert.equal(fileKind("", "readme"), "file");
    assert.equal(kindLabel("image"), "Photo");
    assert.equal(typeLabel("folder", null, "Docs"), "Folder");
    assert.equal(typeLabel("file", "image/jpeg", "cat.jpg"), "Photo (JPG)");
  });

  it("formats byte sizes", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(1024), "1.0 KB");
    assert.equal(formatBytes(1073741824), "1.00 GB");
  });
});

describe("sortNodes", () => {
  const a = { name: "b.txt", kind: "file" as const, mime: "text/plain", size: 20, updatedAt: 2 };
  const b = { name: "a.txt", kind: "file" as const, mime: "text/plain", size: 10, updatedAt: 3 };
  const folder = { name: "Zed", kind: "folder" as const, mime: null, size: 0, updatedAt: 1 };
  const photo = { name: "cat.png", kind: "file" as const, mime: "image/png", size: 50, updatedAt: 4 };

  it("keeps folders first and sorts by name", () => {
    const out = sortNodes([a, folder, b], "name", "asc");
    assert.deepEqual(out.map((n) => n.name), ["Zed", "a.txt", "b.txt"]);
  });

  it("sorts by size and date without mixing folders into files", () => {
    const bySize = sortNodes([a, folder, photo], "size", "desc");
    assert.equal(bySize[0].kind, "folder");
    assert.equal(bySize[1].name, "cat.png");
    const byDate = sortNodes([a, folder, photo], "date", "desc");
    assert.equal(byDate[0].kind, "folder");
    assert.equal(byDate[1].name, "cat.png");
  });

  it("sorts by type label", () => {
    const out = sortNodes([a, photo, folder], "type", "asc");
    assert.equal(out[0].kind, "folder");
    assert.equal(out[1].name, "b.txt");
    assert.equal(out[2].name, "cat.png");
  });
});
