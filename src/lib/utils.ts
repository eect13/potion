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
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type FileKind = "image" | "video" | "audio" | "pdf" | "zip" | "file";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".heic", ".heif", ".bmp", ".avif"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"]);
const ZIP_EXT = new Set([".zip", ".rar", ".7z", ".tar", ".gz"]);

export function fileKind(mime: string | null | undefined, name: string): FileKind {
  const m = (mime || "").toLowerCase();
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (m.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (m.startsWith("video/") || VIDEO_EXT.has(ext)) return "video";
  if (m.startsWith("audio/") || AUDIO_EXT.has(ext)) return "audio";
  if (m === "application/pdf" || ext === ".pdf") return "pdf";
  if (m.includes("zip") || m.includes("compressed") || ZIP_EXT.has(ext)) return "zip";
  return "file";
}
