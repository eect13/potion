import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planFile } from "./potion-plan.ts";

describe("planFile", () => {
  it("uploads, downloads, and agrees", () => {
    assert.equal(planFile({ hash: "a" }, undefined, undefined), "upload");
    assert.equal(planFile(undefined, { hash: "b" }, undefined), "download");
    assert.equal(planFile({ hash: "a" }, { hash: "a" }, undefined), "agree");
  });

  it("keeps both versions when both sides moved", () => {
    assert.equal(planFile({ hash: "local" }, { hash: "remote" }, { hash: "base", conflict: null }), "conflict");
    assert.equal(
      planFile({ hash: "local" }, { hash: "remote" }, { hash: "base", conflict: "local|remote" }),
      "skip",
    );
  });

  it("follows the side that changed since the shared base", () => {
    assert.equal(planFile({ hash: "new" }, { hash: "base" }, { hash: "base", conflict: null }), "upload");
    assert.equal(planFile({ hash: "base" }, { hash: "new" }, { hash: "base", conflict: null }), "download");
  });
});
