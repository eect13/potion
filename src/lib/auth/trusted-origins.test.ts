import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchesOriginPattern } from "../../../node_modules/better-auth/dist/auth/trusted-origins.mjs";
import {
  buildTrustedOrigins,
  DESKTOP_APP_ORIGINS,
  LOCAL_DEV_ORIGINS,
} from "./trusted-origins.ts";

const PREVIEW = ["*.grok-sandbox.com"] as const;

function accepts(trusted: string[], origin: string): boolean {
  return trusted.some((pattern) => matchesOriginPattern(origin, pattern));
}

describe("trustedOrigins desktop path 1 (#4)", () => {
  it("lists http://tauri.localhost (Windows and Android page origin)", () => {
    assert.deepEqual(DESKTOP_APP_ORIGINS, ["http://tauri.localhost"]);
    const trusted = buildTrustedOrigins({ previewAllowedHosts: PREVIEW });
    assert.equal(accepts(trusted, "http://tauri.localhost"), true);
  });

  it("accepts tauri.localhost when BETTER_AUTH_URL is set too", () => {
    const trusted = buildTrustedOrigins({
      explicitBaseURL: "https://potion.example",
      previewAllowedHosts: PREVIEW,
    });
    assert.equal(accepts(trusted, "http://tauri.localhost"), true);
    assert.equal(accepts(trusted, "https://potion.example"), true);
  });

  it("still rejects an untrusted origin", () => {
    const trusted = buildTrustedOrigins({ previewAllowedHosts: PREVIEW });
    assert.equal(accepts(trusted, "http://evil.example"), false);
    assert.equal(accepts(trusted, "https://evil.example"), false);
  });

  it("keeps local loopback origins", () => {
    const trusted = buildTrustedOrigins({ previewAllowedHosts: PREVIEW });
    for (const origin of LOCAL_DEV_ORIGINS) {
      assert.equal(accepts(trusted, origin), true, origin);
    }
  });
});
