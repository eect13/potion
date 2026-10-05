/**
 * Prove path-1 desktop origins against better-auth 1.6.30's matchesOriginPattern
 * (same helper formCsrfMiddleware uses). The package does not export this
 * subpath, so we load the shipped dist file by absolute path.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTrustedOrigins,
  DESKTOP_APP_ORIGINS,
  LOCAL_DEV_ORIGINS,
} from "../src/lib/auth/trusted-origins.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const matcherUrl = pathToFileURL(
  join(root, "node_modules/better-auth/dist/auth/trusted-origins.mjs"),
).href;
const { matchesOriginPattern } = await import(matcherUrl);

const PREVIEW = ["*.grok-sandbox.com"];

function accepts(trusted, origin) {
  return trusted.some((pattern) => matchesOriginPattern(origin, pattern));
}

describe("trustedOrigins desktop path 1 (#4) via better-auth matcher", () => {
  it("accepts http://tauri.localhost (Windows + Android page origin)", () => {
    assert.deepEqual(DESKTOP_APP_ORIGINS, ["http://tauri.localhost"]);
    const trusted = buildTrustedOrigins({ previewAllowedHosts: PREVIEW });
    assert.equal(accepts(trusted, "http://tauri.localhost"), true);
  });

  it("accepts tauri.localhost when BETTER_AUTH_URL is set", () => {
    const trusted = buildTrustedOrigins({
      explicitBaseURL: "https://potion.example",
      previewAllowedHosts: PREVIEW,
    });
    assert.equal(accepts(trusted, "http://tauri.localhost"), true);
  });

  it("still rejects an untrusted origin", () => {
    const trusted = buildTrustedOrigins({ previewAllowedHosts: PREVIEW });
    assert.equal(accepts(trusted, "http://evil.example"), false);
  });

  it("keeps local loopback origins", () => {
    const trusted = buildTrustedOrigins({ previewAllowedHosts: PREVIEW });
    for (const origin of LOCAL_DEV_ORIGINS) {
      assert.equal(accepts(trusted, origin), true, origin);
    }
  });
});
