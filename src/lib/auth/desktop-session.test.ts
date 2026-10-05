import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DESKTOP_SERVER_KEY,
  DESKTOP_TOKEN_KEY,
  readBearerToken,
  readDesktopCloudAuth,
  resolveSignedInUser,
} from "./desktop-session.ts";

function mem(init: Record<string, string> = {}) {
  const data = { ...init };
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
}

describe("desktop signed-in check (#7)", () => {
  it("stays signed out when only the token or only the server is set (fail at base shape)", () => {
    assert.equal(
      readDesktopCloudAuth(mem({ [DESKTOP_TOKEN_KEY]: "tok" })),
      null,
    );
    assert.equal(
      readDesktopCloudAuth(mem({ [DESKTOP_SERVER_KEY]: "https://srv.example" })),
      null,
    );
    assert.equal(
      resolveSignedInUser({
        sessionUser: null,
        desktopAuth: null,
        fromSession: (u: { id: string }) => ({
          id: u.id,
          displayName: null,
          primaryEmail: null,
          profileImageUrl: null,
        }),
      }),
      null,
    );
  });

  it("flips to a signed-in user when desktop token and server URL are both set", () => {
    const storage = mem({
      [DESKTOP_SERVER_KEY]: "https://srv.example/",
      [DESKTOP_TOKEN_KEY]: "tok-abc",
    });
    const auth = readDesktopCloudAuth(storage);
    assert.deepEqual(auth, { server: "https://srv.example", token: "tok-abc" });
    const user = resolveSignedInUser({
      sessionUser: null,
      desktopAuth: auth,
      fromSession: (u: { id: string }) => ({
        id: u.id,
        displayName: null,
        primaryEmail: null,
        profileImageUrl: null,
      }),
    });
    assert.ok(user);
    assert.equal(user.id, "desktop-session");
    assert.equal(user.isDevFallback, false);
    // PotionApp: mode = user ? "cloud" : "local"
    const mode = user ? "cloud" : "local";
    assert.equal(mode, "cloud");
  });

  it("prefers a real session user over the desktop fallback", () => {
    const user = resolveSignedInUser({
      sessionUser: { id: "u1", name: "Ada", email: "a@e", image: null },
      desktopAuth: { server: "https://srv.example", token: "tok" },
      fromSession: (u) => ({
        id: u.id,
        displayName: u.name,
        primaryEmail: u.email,
        profileImageUrl: u.image,
      }),
    });
    assert.equal(user?.id, "u1");
    assert.equal(user?.displayName, "Ada");
  });

  it("getBearerToken-style read sees the desktop token", () => {
    const token = readBearerToken({
      sessionStorage: mem(),
      localStorage: mem({ [DESKTOP_TOKEN_KEY]: "desk-tok" }),
      sessionKey: "grok-auth.bearer-token",
    });
    assert.equal(token, "desk-tok");
  });
});
