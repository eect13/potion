/** Desktop / APK stub — cloud locker is the website. Guest files stay local. */
const unavailable = (..._args: unknown[]) =>
  Promise.reject(new Error("Cloud locker lives on the website. Files on this computer stay local."));

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

export function toB64(s: string) {
  return btoa(unescape(encodeURIComponent(s)));
}

export function fromB64(s: string) {
  return decodeURIComponent(escape(atob(s)));
}
