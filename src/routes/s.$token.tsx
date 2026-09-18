import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PotionMark } from "@/components/potion-mark";
import * as db from "@/lib/potion-db";
import { formatBytes } from "@/lib/utils";

export const Route = createFileRoute("/s/$token")({ component: SharePage });

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

  useEffect(() => {
    void (async () => {
      await db.ensureSeeded();
      const hit = await db.getShare(token);
      if (!hit) {
        setState("gone");
        return;
      }
      setName(hit.node.name);
      setSize(hit.node.size);
      setKind(hit.node.kind);
      setNodeId(hit.node.id);
      if (hit.node.kind === "folder") {
        const list = await db.listChildren(hit.node.id);
        setKids(list.map((n) => ({ id: n.id, name: n.name, kind: n.kind, size: n.size })));
      }
      if (hit.share.password) {
        setNeed(hit.share.password);
        setState("gate");
      } else setState("ready");
    })();
  }, [token]);

  async function download(id = nodeId, fileName = name) {
    if (!id) return;
    const blob = await db.currentBlob(id);
    if (!blob) return;
    const url = URL.createObjectURL(new Blob([blob.bytes], { type: blob.mime || "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6">
        <PotionMark className="size-12" />
        <p className="mt-4 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">Shared with Potion</p>
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
      </div>
    </main>
  );
}
