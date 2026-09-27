const KEY = "potion-resume";

export type ResumeJob = {
  key: string;
  hash: string;
  name: string;
  mime: string;
  size: number;
  parentId: string | null;
  cloudId?: string;
  version?: number;
  localId?: string;
  localVersion?: number;
};

/** Two different files can share bytes. Resume follows the folder and the name. */
export function jobKey(parentId: string | null, name: string) {
  return `${parentId ?? ""}/${name}`;
}

function readAll(): ResumeJob[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as ResumeJob[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(jobs: ResumeJob[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    /* storage full — the upload itself is the limit */
  }
}

export function listJobs() {
  return readAll();
}

export function jobFor(parentId: string | null, name: string) {
  const key = jobKey(parentId, name);
  return readAll().find((j) => j.key === key || (!j.key && j.parentId === parentId && j.name === name));
}

export function saveJob(job: ResumeJob) {
  const all = readAll().filter((j) => j.key !== job.key);
  all.push(job);
  writeAll(all);
}

export function clearJob(parentId: string | null, name: string) {
  const key = jobKey(parentId, name);
  writeAll(readAll().filter((j) => j.key !== key));
}