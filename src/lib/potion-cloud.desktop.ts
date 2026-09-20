/** Desktop / APK stub — signed-in files live on a self-hosted Potion. Guest files stay local. */
const unavailable = (..._args: unknown[]) =>
  Promise.reject(new Error("Signed-in files live on a self-hosted Potion. Files on this computer stay local."));

export const ensureCloud = unavailable;
export const listCloud = unavailable;
export const listAllCloud = unavailable;
export const pathCloud = unavailable;
export const mkdirCloud = unavailable;
export const putCloud = unavailable;
export const commitCloud = unavailable;
export const trashCloud = unavailable;
export const getCloud = unavailable;
export const copyCloud = unavailable;
export const moveCloud = unavailable;
export const syncCloud = unavailable;
export const shareCloud = unavailable;
export const getSharedCloud = unavailable;
export const getSharedFileCloud = unavailable;
export const getSharedBlobChunk = unavailable;
export const listTargetsCloud = unavailable;
export const renameCloud = unavailable;
export const searchCloud = unavailable;
export const usedBytesCloud = unavailable;
export const listTrashCloud = unavailable;
export const restoreCloud = unavailable;
export const purgeCloud = unavailable;
export const emptyTrashCloud = unavailable;
export const putBlobChunk = unavailable;
export const getBlobChunk = unavailable;
export const statBlob = unavailable;
export const listVersionsCloud = unavailable;
export const revertCloud = unavailable;
export const listCommentsCloud = unavailable;
export const addCommentCloud = unavailable;
