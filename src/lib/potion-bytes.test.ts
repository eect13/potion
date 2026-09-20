import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fromBase64, toBase64 } from "./potion-bytes.ts";
import { fingerprint, SLICE } from "./potion-blob.ts";
import { formatBytes } from "./utils.ts";

describe("potion bytes", () => {
  it("round-trips a 1 MB slice", () => {
    const src = new Uint8Array(SLICE);
    for (let i = 0; i < src.length; i += 97) src[i] = i % 251;
    const back = fromBase64(toBase64(src));
    assert.equal(back.byteLength, src.byteLength);
    assert.equal(back[0], src[0]);
    assert.equal(back[96], src[96]);
    assert.equal(back[SLICE - 1], src[SLICE - 1]);
  });

  it("treats empty as empty", () => {
    assert.equal(fromBase64("").byteLength, 0);
    assert.equal(fromBase64(toBase64(new Uint8Array(0))).byteLength, 0);
  });
});

describe("fingerprint", () => {
  it("is stable for multi-slice blobs and does not cap size", async () => {
    const bytes = new Uint8Array(SLICE + 24);
    bytes.fill(9);
    bytes[0] = 1;
    bytes[SLICE] = 2;
    const blob = new Blob([bytes]);
    const a = await fingerprint(blob);
    const b = await fingerprint(blob);
    assert.equal(a.length, 64);
    assert.equal(a, b);
    const other = new Uint8Array(bytes);
    other[SLICE] = 3;
    const c = await fingerprint(new Blob([other]));
    assert.notEqual(a, c);
  });
});

describe("formatBytes", () => {
  it("prints gigabytes", () => {
    assert.equal(formatBytes(1073741824), "1.00 GB");
  });
});
