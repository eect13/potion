import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PotionMark } from "@/components/potion-mark";
import { APP_VERSION_LABEL } from "@/lib/version";
import * as db from "@/lib/potion-db";
import * as cloud from "@/lib/potion-cloud";
import { pullSharedFile, addSharedComment, listSharedComments, mediaUrl } from "@/lib/potion-api";
import { fileKind, formatBytes } from "@/lib/utils";

export const Route = createFileRoute("/s/$token")({ component: SharePage });

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function SharePage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<"load" | "gone" | "gate" | "ready">("load");
  const [name, setName] = useState("");
  const [size, setSize] = useState(0);
  const [kind, setKind] = useState<"file" | "folder">("file");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [need, setNeed] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [kids, setKids] = useState<{ id: string; name: string; kind: string; size: number }[]>([]);
  const [remote, setRemote] = useState(false);
  const [version, setVersion] = useState(1);
  const [mime, setMime] = useState<string | null>(null);
  const [comments, setComments] = useState<{ id: string; body: string; author: string | null; createdAt: number }[]>([]);
  const [note, setNote] = useState("");
  const [who, setWho] = useState("");

  useEffect(() => {
    void (async () => {
      await db.ensureSeeded();
      const hit = await db.getShare(token);
      if (hit) {
        setName(hit.node.name);
        setSize(hit.node.size);
        setKind(hit.node.kind);
        setNodeId(hit.node.id);
        setVersion(hit.node.version);
        setMime(hit.node.mime);
        setRemote(false);
        if (hit.node.kind === "folder") {
          const list = await db.listChildren(hit.node.id);
          setKids(list.map((n) => ({ id: n.id, name: n.name, kind: n.kind, size: n.size })));
        }
        if (hit.share.password) {
          setNeed(hit.share.password);
          setState("gate");
        } else setState("ready");
        return;
      }
      try {
        const shared = await cloud.getSharedCloud({ data: token });
        if (!shared) {
          setState("gone");
          return;
        }
        setName(shared.node.name);
        setSize(shared.node.size);
        setKind(shared.node.kind);
        setNodeId(shared.node.id);
        setVersion(shared.node.version);
        setMime(shared.node.mime);
        setKids(shared.kids.map((n) => ({ id: n.id, name: n.name, kind: n.kind, size: n.size })));
        setRemote(true);
        setState("ready");
      } catch {
        setState("gone");
      }
    })();
  }, [token]);

  useEffect(() => {
    if (state !== "ready" || !nodeId) return;
    void (async () => {
      if (!remote) {
        const rows = await db.listComments(nodeId);
        setComments(rows);
        return;
      }
      setComments(await listSharedComments(token));
    })().catch(() => setComments([]));
  }, [state, nodeId, remote, token]);

  async function postNote() {
    if (!nodeId || !note.trim()) return;
    if (!remote) {
      const row = await db.addComment(nodeId, note, who || "Guest");
      setComments((cur) => [...cur, row]);
    } else {
      const row = await addSharedComment(token, note, who || "Guest");
      setComments((cur) => [...cur, row]);
    }
    setNote("");
  }

  async function download(id = nodeId, fileName = name) {
    if (!id) return;
    if (!remote) {
      const file = await db.currentFile(id);
      if (!file) return;
      saveBlob(file.blob, fileName);
      return;
    }
    const file = await pullSharedFile(token, id);
    if (!file) return;
    saveBlob(file.blob, file.name);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6">
        <PotionMark className="size-12" />
        <p className="mt-4 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">Shared with Potion · {APP_VERSION_LABEL}</p>
        <h1 className="mt-2 font-serif text-3xl italic">
          {state === "gone" ? "Link gone" : state === "load" ? "…" : name}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {state === "ready" || state === "gate" ? (kind === "folder" ? "Folder" : formatBytes(size)) : null}
        </p>
        {state === "gate" ? (
          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (password !== need) {
                setErr("Wrong password");
                return;
              }
              setState("ready");
            }}
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="h-11 w-full rounded-lg border border-border bg-background px-3"
            />
            <button type="submit" className="h-11 w-full rounded-full bg-accent font-medium text-accent-foreground">
              Unlock
            </button>
            {err ? <p className="text-sm text-destructive">{err}</p> : null}
          </form>
        ) : null}
        {state === "ready" && kind === "file" ? (
          <button
            type="button"
            onClick={() => void download()}
            className="mt-6 h-11 w-full rounded-full bg-accent font-medium text-accent-foreground"
          >
            Download
          </button>
        ) : null}
        {state === "ready" && kind === "folder" ? (
          <ul className="mt-6 space-y-2">
            {kids.length === 0 ? <p className="text-sm text-muted">Empty folder.</p> : null}
            {kids.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 rounded-lg bg-elevated px-3 py-2 text-sm">
                <span className="truncate">{k.name}</span>
                {k.kind === "file" ? (
                  <button type="button" className="h-11 text-sm text-muted" onClick={() => void download(k.id, k.name)}>
                    Get
                  </button>
                ) : (
                  <span className="text-xs text-faint">Folder</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {state === "ready" && remote && kind === "file" && (fileKind(mime, name) === "video" || fileKind(mime, name) === "audio" || fileKind(mime, name) === "pdf") ? (
          <div className="mt-4">
            {fileKind(mime, name) === "video" ? (
              <video src={mediaUrl({ id: nodeId || "", version }, token)} controls className="max-h-64 w-full rounded-lg bg-elevated" />
            ) : null}
            {fileKind(mime, name) === "audio" ? (
              <audio src={mediaUrl({ id: nodeId || "", version }, token)} controls className="w-full" />
            ) : null}
            {fileKind(mime, name) === "pdf" ? (
              <iframe title={name} src={mediaUrl({ id: nodeId || "", version }, token)} className="h-64 w-full rounded-lg bg-elevated" />
            ) : null}
          </div>
        ) : null}
        {state === "ready" ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-foreground">Comments</p>
            <ul className="max-h-40 space-y-2 overflow-auto">
              {comments.length === 0 ? <li className="text-sm text-muted">No comments yet.</li> : null}
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-elevated px-3 py-2">
                  <p className="text-sm text-foreground">{c.body}</p>
                  <p className="mt-1 text-xs text-faint">{c.author || "Guest"}</p>
                </li>
              ))}
            </ul>
            <input
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder="Your name"
              className="h-11 w-full rounded-lg border border-border bg-background px-3"
            />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Write a comment"
              className="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <button type="button" onClick={() => void postNote()} className="h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground">
              Post
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
