/** Desktop "Sign in on that server" session — token + server URL (claim #7). */

export const DESKTOP_SERVER_KEY = "potion-server";
export const DESKTOP_TOKEN_KEY = "potion-desktop-token";
/** Dispatched after desktopSignIn stores a token so the UI can flip to cloud. */
export const DESKTOP_AUTH_CHANGED = "potion-desktop-auth";

export type DesktopCloudAuth = { server: string; token: string };

/** Read localStorage; both server URL and token required. */
export function readDesktopCloudAuth(
  storage: Pick<Storage, "getItem"> | null | undefined,
): DesktopCloudAuth | null {
  if (!storage) return null;
  try {
    const server = (storage.getItem(DESKTOP_SERVER_KEY) || "").replace(/\/$/, "");
    const token = storage.getItem(DESKTOP_TOKEN_KEY) || "";
    if (!server || !token) return null;
    return { server, token };
  } catch {
    return null;
  }
}

/**
 * Snapshot for `useSyncExternalStore`. Must be referentially stable while the
 * underlying server URL + token are unchanged (React compares with Object.is;
 * a fresh object every call → infinite re-render / error #185).
 */
let snapshotCache: DesktopCloudAuth | null = null;
let snapshotKey = "";

export function getDesktopAuthSnapshot(
  storage: Pick<Storage, "getItem"> | null | undefined,
): DesktopCloudAuth | null {
  const next = readDesktopCloudAuth(storage);
  const key = next ? `${next.server}\n${next.token}` : "";
  if (key === snapshotKey) return snapshotCache;
  snapshotKey = key;
  snapshotCache = next;
  return snapshotCache;
}

/** Test helper: clear the snapshot cache between cases. */
export function resetDesktopAuthSnapshotCache(): void {
  snapshotCache = null;
  snapshotKey = "";
}

/**
 * Prefer a real Better Auth session user; else treat desktop token+server as
 * signed in so Sync/Folder flip to cloud after desktopSignIn.
 */
export function resolveSignedInUser<TUser>(opts: {
  sessionUser: TUser | null | undefined;
  desktopAuth: DesktopCloudAuth | null;
  fromSession: (sessionUser: TUser) => {
    id: string;
    displayName: string | null;
    primaryEmail: string | null;
    profileImageUrl: string | null;
  };
}): {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
  isDevFallback: boolean;
} | null {
  if (opts.sessionUser) {
    return { ...opts.fromSession(opts.sessionUser), isDevFallback: false };
  }
  if (opts.desktopAuth) {
    return {
      id: "desktop-session",
      displayName: null,
      primaryEmail: null,
      profileImageUrl: null,
      isDevFallback: false,
    };
  }
  return null;
}

/** Bearer for auth client: preview sessionStorage first, then desktop token. */
export function readBearerToken(opts: {
  sessionStorage: Pick<Storage, "getItem"> | null | undefined;
  localStorage: Pick<Storage, "getItem"> | null | undefined;
  sessionKey: string;
}): string | null {
  try {
    const fromSession = opts.sessionStorage?.getItem(opts.sessionKey) || "";
    if (fromSession) return fromSession;
    const fromDesktop = opts.localStorage?.getItem(DESKTOP_TOKEN_KEY) || "";
    return fromDesktop || null;
  } catch {
    return null;
  }
}
