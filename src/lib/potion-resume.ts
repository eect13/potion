const KEY = "potion-resume";

export type ResumeJob = {
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

export function jobFor(hash: string) {
  return readAll().find((j) => j.hash === hash);
}

export function saveJob(job: ResumeJob) {
  const all = readAll().filter((j) => j.hash !== job.hash);
  all.push(job);
  writeAll(all);
}

export function clearJob(hash: string) {
  writeAll(readAll().filter((j) => j.hash !== hash));
}
