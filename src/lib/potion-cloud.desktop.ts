/** Desktop talks to a Potion server you run. No hosted file service. */

const SERVER_KEY = "potion-server";
const TOKEN_KEY = "potion-desktop-token";

function serverBase() {
  try {
    return (localStorage.getItem(SERVER_KEY) || "").replace(/\/$/, "");
  } catch {
    return "";
  }
}

function token() {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem("grok-auth.bearer-token") || "";
  } catch {
    return "";
  }
}

async function call(op: string, data?: unknown) {
  const base = serverBase();
  if (!base) {
    throw new Error("Set your Potion server on Sync. This computer does not use a hosted service.");
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  const bearer = token();
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`${base}/api/potion-rpc`, {
    method: "POST",
    headers,
    body: JSON.stringify({ op, data }),
  });
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (!res.ok) throw new Error(json.error || "Server refused");
  return json.result;
}

const remote =
  (op: string) =>
  (opts?: { data?: unknown }) =>
    call(op, opts?.data);

export const ensureCloud = () => call("ensureCloud");
export const listCloud = remote("listCloud");
export const listAllCloud = remote("listAllCloud");
export const pathCloud = remote("pathCloud");
export const mkdirCloud = remote("mkdirCloud");
export const putCloud = remote("putCloud");
export const commitCloud = remote("commitCloud");
export const trashCloud = remote("trashCloud");
export const getCloud = remote("getCloud");
export const copyCloud = remote("copyCloud");
export const moveCloud = remote("moveCloud");
export const syncCloud = remote("syncCloud");
export const shareCloud = remote("shareCloud");
export const getSharedCloud = remote("getSharedCloud");
export const getSharedFileCloud = remote("getSharedFileCloud");
export const getSharedBlobChunk = remote("getSharedBlobChunk");
export const listTargetsCloud = remote("listTargetsCloud");
export const renameCloud = remote("renameCloud");
export const searchCloud = remote("searchCloud");
export const usedBytesCloud = remote("usedBytesCloud");
export const listTrashCloud = remote("listTrashCloud");
export const restoreCloud = remote("restoreCloud");
export const purgeCloud = remote("purgeCloud");
export const emptyTrashCloud = () => call("emptyTrashCloud");
export const putBlobChunk = remote("putBlobChunk");
export const getBlobChunk = remote("getBlobChunk");
export const statBlob = remote("statBlob");
export const listVersionsCloud = remote("listVersionsCloud");
export const revertCloud = remote("revertCloud");
export const listCommentsCloud = remote("listCommentsCloud");
export const addCommentCloud = remote("addCommentCloud");
export const listSharedComments = remote("listSharedComments");
export const addSharedComment = remote("addSharedComment");
export const listBasesCloud = () => call("listBasesCloud");
export const setBaseCloud = remote("setBaseCloud");
export const beginStashCloud = remote("beginStashCloud");
export const commitStashCloud = remote("commitStashCloud");

export async function desktopSignIn(email: string, password: string) {
  const base = serverBase();
  if (!base) throw new Error("Set your Potion server first");
  const res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Sign-in failed");
  const bearer = res.headers.get("set-auth-token");
  if (bearer) localStorage.setItem(TOKEN_KEY, bearer);
  return Boolean(bearer);
}
