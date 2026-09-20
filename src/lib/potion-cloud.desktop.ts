/** Desktop / APK stub — signed-in files live on the website. Guest files stay local. */
const unavailable = (..._args: unknown[]) =>
  Promise.reject(new Error("Signed-in files live on the website. Files on this computer stay local."));

export const ensureCloud = unavailable;
export const listCloud = unavailable;
export const pathCloud = unavailable;
export const mkdirCloud = unavailable;
export const putCloud = unavailable;
export const trashCloud = unavailable;
export const getCloud = unavailable;
export const copyCloud = unavailable;
export const moveCloud = unavailable;
export const syncCloud = unavailable;
export const shareCloud = unavailable;
export const listTargetsCloud = unavailable;
export const renameCloud = unavailable;
export const searchCloud = unavailable;
export const usedBytesCloud = unavailable;
export const listTrashCloud = unavailable;
export const restoreCloud = unavailable;
export const purgeCloud = unavailable;
export const emptyTrashCloud = unavailable;

export function toB64(s: string) {
  return btoa(unescape(encodeURIComponent(s)));
}

export function fromB64(s: string) {
  return decodeURIComponent(escape(atob(s)));
}
