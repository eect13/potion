import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertAuthSecret,
  guardAuthUse,
  isDeployedProduction,
  MissingAuthSecretError,
} from "./secret.ts";

const PROD = { NODE_ENV: "production", VERCEL_ENV: "production" };

/** Stand-in for the Better Auth instance: `api` / `handler` are the use points. */
function fakeAuth() {
  return {
    options: { baseURL: "x" },
    api: { getSession: async () => null },
    handler: async () => new Response("ok"),
  };
}

describe("isDeployedProduction", () => {
  it("is false for local dev, the built QA preview and host preview deploys", () => {
    assert.equal(isDeployedProduction({}), false);
    assert.equal(isDeployedProduction({ NODE_ENV: "development" }), false);
    assert.equal(isDeployedProduction({ NODE_ENV: "production" }), false);
    assert.equal(isDeployedProduction({ NODE_ENV: "production", VERCEL_ENV: "preview" }), false);
    assert.equal(
      isDeployedProduction({ NODE_ENV: "production", CONTEXT: "deploy-preview" }),
      false,
    );
  });

  it("is true for a production host or the Grok deployer markers", () => {
    assert.equal(isDeployedProduction(PROD), true);
    assert.equal(isDeployedProduction({ CONTEXT: "production" }), true);
    assert.equal(isDeployedProduction({ NODE_ENV: "production", GROK_PROJECT_ID: "p1" }), true);
    assert.equal(
      isDeployedProduction({ NODE_ENV: "production", BETTER_AUTH_URL: "https://a.app" }),
      true,
    );
  });
});

describe("production auth secret guard", () => {
  it("production with auth off and no secret boots and serves fine", async () => {
    const env = { ...PROD, VITE_AUTH_ENABLED: "false" };
    assert.doesNotThrow(() => assertAuthSecret(env));
    const auth = guardAuthUse(fakeAuth(), () => assertAuthSecret(env));
    assert.equal(auth.options.baseURL, "x");
    assert.equal(await auth.api.getSession(), null);
  });

  it("production with auth on and no secret throws a clear error on first use, not at boot", () => {
    const env = { ...PROD, VITE_AUTH_ENABLED: "true" };
    // Wrapping (module import / boot) never throws.
    const auth = guardAuthUse(fakeAuth(), () => assertAuthSecret(env));
    assert.equal(auth.options.baseURL, "x");
    assert.throws(() => auth.api, MissingAuthSecretError);
    assert.throws(() => auth.handler, /BETTER_AUTH_SECRET is not set/);
    // Unset VITE_AUTH_ENABLED means auth on (same rule as server.ts).
    assert.throws(() => assertAuthSecret(PROD), MissingAuthSecretError);
    // Blank counts as unset.
    assert.throws(
      () => assertAuthSecret({ ...env, BETTER_AUTH_SECRET: "  " }),
      MissingAuthSecretError,
    );
  });

  it("production with auth on and a secret is fine", () => {
    const env = { ...PROD, BETTER_AUTH_SECRET: "s3cret-for-test" };
    const auth = guardAuthUse(fakeAuth(), () => assertAuthSecret(env));
    assert.doesNotThrow(() => auth.api);
  });

  it("dev and preview keep the random-secret fallback with auth on", () => {
    assert.doesNotThrow(() => assertAuthSecret({ NODE_ENV: "development" }));
    assert.doesNotThrow(() => assertAuthSecret({ NODE_ENV: "production" }));
    assert.doesNotThrow(() => assertAuthSecret({ NODE_ENV: "production", VERCEL_ENV: "preview" }));
  });
});
