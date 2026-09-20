import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(n: number) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1073741824) return `${(v / 1048576).toFixed(1)} MB`;
  return `${(v / 1073741824).toFixed(2)} GB`;
}

export function formatWhen(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type FileKind = "image" | "video" | "audio" | "pdf" | "zip" | "file";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".heic", ".heif", ".bmp", ".avif"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"]);
const ZIP_EXT = new Set([".zip", ".rar", ".7z", ".tar", ".gz"]);

export function fileExt(name: string) {
  const i = name.lastIndexOf(".");
  if (i <= 0) return "";
  return name.slice(i).toLowerCase();
}

export function fileKind(mime: string | null | undefined, name: string): FileKind {
  const m = (mime || "").toLowerCase();
  const ext = fileExt(name);
  if (m.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (m.startsWith("video/") || VIDEO_EXT.has(ext)) return "video";
  if (m.startsWith("audio/") || AUDIO_EXT.has(ext)) return "audio";
  if (m === "application/pdf" || ext === ".pdf") return "pdf";
  if (m.includes("zip") || m.includes("compressed") || ZIP_EXT.has(ext)) return "zip";
  return "file";
}

export function kindLabel(kind: FileKind | "folder") {
  if (kind === "folder") return "Folder";
  if (kind === "image") return "Photo";
  if (kind === "video") return "Video";
  if (kind === "audio") return "Audio";
  if (kind === "pdf") return "PDF";
  if (kind === "zip") return "Archive";
  return "File";
}

export function typeLabel(kind: "file" | "folder", mime: string | null | undefined, name: string) {
  if (kind === "folder") return "Folder";
  const ext = fileExt(name).replace(".", "").toUpperCase();
  const label = kindLabel(fileKind(mime, name));
  return ext ? `${label} (${ext})` : label;
}

export type SortKey = "name" | "date" | "type" | "size";
export type SortDir = "asc" | "desc";

type Sortable = {
  name: string;
  kind: "file" | "folder";
  mime: string | null;
  size: number;
  updatedAt: number;
};

function cmp(a: string | number, b: string | number) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function sortNodes<T extends Sortable>(items: T[], key: SortKey, dir: SortDir, foldersFirst = true): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (foldersFirst && a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    let av: string | number = a.name;
    let bv: string | number = b.name;
    if (key === "date") {
      av = a.updatedAt;
      bv = b.updatedAt;
    } else if (key === "size") {
      av = a.kind === "folder" ? -1 : a.size;
      bv = b.kind === "folder" ? -1 : b.size;
    } else if (key === "type") {
      av = typeLabel(a.kind, a.mime, a.name);
      bv = typeLabel(b.kind, b.mime, b.name);
    } else {
      av = a.name;
      bv = b.name;
    }
    const d = cmp(av, bv);
    if (d !== 0) return d * sign;
    return cmp(a.name, b.name);
  });
}
