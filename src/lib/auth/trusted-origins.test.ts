import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTrustedOrigins,
  DESKTOP_APP_ORIGINS,
  LOCAL_DEV_ORIGINS,
} from "./trusted-origins.ts";

const PREVIEW = ["*.grok-sandbox.com"] as const;

describe("buildTrustedOrigins list (#4)", () => {
  it("includes http://tauri.localhost for preview and deployed configs", () => {
    assert.deepEqual(DESKTOP_APP_ORIGINS, ["http://tauri.localhost"]);
    const preview = buildTrustedOrigins({ previewAllowedHosts: PREVIEW });
    const deployed = buildTrustedOrigins({
      explicitBaseURL: "https://potion.example",
      previewAllowedHosts: PREVIEW,
    });
    assert.ok(preview.includes("http://tauri.localhost"));
    assert.ok(deployed.includes("http://tauri.localhost"));
    assert.ok(deployed.includes("https://potion.example"));
    for (const origin of LOCAL_DEV_ORIGINS) {
      assert.ok(preview.includes(origin), origin);
    }
  });

  it("does not list an untrusted origin", () => {
    const trusted = buildTrustedOrigins({ previewAllowedHosts: PREVIEW });
    assert.equal(trusted.includes("http://evil.example"), false);
  });
});
