import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { Folder, FileText, Upload, Save, Trash2, Blocks, Copy, RotateCcw, Cloud, Sun, Moon, PanelLeftClose, PanelLeft, LogIn, Share2, CloudOff, MoreHorizontal, FolderInput, Link2, Play, Pause, Square, Plus, LayoutList, LayoutGrid, Image as ImageIcon, Film, Music, FileArchive, File as FileIcon, Smartphone } from "lucide-react";
import { PotionMark } from "@/components/potion-mark";
import { APP_VERSION_LABEL } from "@/lib/version";
import { readTheme, writeTheme, type Theme } from "@/lib/theme";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import * as api from "@/lib/potion-api";
import type { ConnectedApp, PotionNode, RestoreRecord, StoreMode } from "@/lib/potion-api";
import { formatBytes, cn, fileKind } from "@/lib/utils";
import { pauseSync, retrySync, startSync, stopSync, subscribeSync, type SyncState } from "@/lib/potion-sync";

type View = "folder" | "apps" | "sync";
type Layout = "list" | "grid";

function backupPayload(app: string) {
  return JSON.stringify({ app, kind: "backup", createdAt: new Date().toISOString() }, null, 2);
}

export function PotionApp() {
  const { user, isPending } = useCurrentUserState();
  const mode: StoreMode = user ? "cloud" : "local";
  const [view, setView] = useState<View>("folder");
  const [parentId, setParentId] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<PotionNode[]>([]);
  const [items, setItems] = useState<PotionNode[]>([]);
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [backups, setBackups] = useState<PotionNode[]>([]);
  const [restored, setRestored] = useState<RestoreRecord | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<ReactNode>(null);
  const [over, setOver] = useState(false);
  const [ready, setReady] = useState(false);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [space, setSpace] = useState("");
  const [theme, setTheme] = useState<Theme>("dark");
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>("list");
  const [preview, setPreview] = useState<PotionNode | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef(0);

  const ping = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2400);
  };

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    writeTheme(next);
  }

  function toggleRail() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("potion-rail", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function setLayoutMode(next: Layout) {
    setLayout(next);
    try {
      localStorage.setItem("potion-layout", next);
    } catch {
      /* ignore */
    }
  }

  const refresh = useCallback(async () => {
    if (isPending) return;
    await api.ensurePotion(mode);
    setItems(await api.listNodes(mode, parentId));
    const path = await api.pathOf(mode, parentId);
    setCrumbs(path);
    setSelected(null);
    setMenuFor(null);
    const nextApps = await api.connectedApps(mode);
    setApps(nextApps);
    setRestored(api.lastRestore());
    setSpace(api.spaceKey());
    const appName = nextApps.find((a) => path.some((c) => c.name === a.name))?.name;
    if (appName) {
      const b = await api.listAppBackups(mode, appName);
      setBackups(b.files);
    } else {
      setBackups([]);
    }
    setReady(true);
  }, [mode, parentId, isPending]);

  useEffect(() => {
    void refresh().catch(() => setReady(true));
  }, [refresh]);

  useEffect(() => {
    const t = readTheme();
    setTheme(t);
    writeTheme(t);
    try {
      setCollapsed(localStorage.getItem("potion-rail") === "1");
      setLayout(localStorage.getItem("potion-layout") === "grid" ? "grid" : "list");
    } catch {
      /* ignore */
    }
  }, []);

  const activeApp = crumbs.find((c) => apps.some((a) => a.name === c.name))?.name;
  const module = activeApp
    ? { backupLabel: `Save a ${activeApp} backup`, payload: () => backupPayload(activeApp) }
    : null;

  async function upload(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      await api.putFiles(mode, parentId, Array.from(files));
      ping(`Added ${files.length} file${files.length === 1 ? "" : "s"}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveBackup() {
    if (!activeApp || !module) return;
    setBusy(true);
    try {
      const made = await api.saveAppBackup(mode, activeApp, module.payload());
      ping(`Saved ${made.name}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function restore(node: PotionNode) {
    setBusy(true);
    try {
      const result = await api.restoreBackup(mode, node.id, user ? "account" : "this-device");
      ping(`Handed ${result.fileName} to the app`);
      setSheet(
        <div className="space-y-4">
          <h3 className="font-serif text-2xl italic">File ready</h3>
          <p className="text-sm text-muted">
            Potion carried <span className="text-foreground">{result.fileName}</span>. The other app
            opens it — Potion does not.
          </p>
          {result.preview ? (
            <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-elevated p-3 font-mono text-xs text-muted">
              {result.preview}
            </pre>
          ) : null}
          <div className="flex justify-end">
            <button
              type="button"
              className="h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground"
              onClick={() => setSheet(null)}
            >
              Done
            </button>
          </div>
        </div>,
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function download(node: PotionNode) {
    const file = await api.getFile(mode, node.id);
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.bytes], { type: file.mime || "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyItem(node: PotionNode) {
    await api.copyNode(mode, node.id, node.parentId);
    ping(`Copied ${node.name}`);
    setMenuFor(null);
    await refresh();
  }

  async function deleteItem(node: PotionNode) {
    await api.trashNode(mode, node.id);
    ping(`Deleted ${node.name}`);
    setSelected(null);
    setMenuFor(null);
    await refresh();
  }

  async function toggleSync(node: PotionNode) {
    const next = node.synced === false;
    await api.setSynced(mode, node.id, next);
    ping(next ? `Syncing ${node.name}` : `${node.name} stays on this device`);
    setMenuFor(null);
    await refresh();
  }

  async function shareItem(node: PotionNode) {
    const share = await api.shareNode(mode, node.id);
    const origin =
      mode === "cloud" ? "https://potion-eect13.vercel.app" : window.location.origin;
    const url = `${origin}/s/${share.token}`;
    setMenuFor(null);
    setSheet(
      <ShareSheet
        name={node.name}
        url={url}
        onCopy={() => {
          void navigator.clipboard.writeText(url);
          ping("Link copied");
        }}
        onClose={() => setSheet(null)}
      />,
    );
  }

  async function moveItem(node: PotionNode) {
    const targets = await api.listFolderTargets(mode, node.kind === "folder" ? node.id : undefined);
    setMenuFor(null);
    setSheet(
      <MoveSheet
        name={node.name}
        targets={targets}
        onPick={async (dest) => {
          await api.moveNode(mode, node.id, dest);
          ping(`Moved ${node.name}`);
          setSheet(null);
          await refresh();
        }}
        onClose={() => setSheet(null)}
      />,
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground md:flex-row">
      <aside
        className={cn(
          "hidden z-0 shrink-0 flex-col border-r border-border bg-card md:flex",
          collapsed ? "w-16 px-2 py-4" : "w-56 px-4 py-5",
        )}
      >
        <Brand collapsed={collapsed} />
        <div className="mt-6 flex-1">
          <Nav view={view} setView={setView} collapsed={collapsed} />
        </div>
        <div className={cn("flex flex-col gap-1 border-t border-border pt-3", collapsed && "items-center")}>
          <ThemeToggle theme={theme} onToggle={toggleTheme} collapsed={collapsed} />
          <button
            type="button"
            onClick={toggleRail}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex h-11 items-center gap-3 rounded-lg text-sm text-muted hover:bg-elevated hover:text-foreground",
              collapsed ? "w-11 justify-center" : "px-3",
            )}
          >
            {collapsed ? <PanelLeft className="size-4" strokeWidth={1.75} /> : <PanelLeftClose className="size-4" strokeWidth={1.75} />}
            {collapsed ? null : <span>Collapse</span>}
          </button>
          <div className={cn(!collapsed && "px-1 pt-1")}>
            <AuthSlot isPending={isPending} hasUser={!!user} collapsed={collapsed} />
          </div>
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:hidden">
          <Brand collapsed={false} />
          <div className="flex items-center gap-1">
            <ThemeToggle theme={theme} onToggle={toggleTheme} collapsed />
            <AuthSlot isPending={isPending} hasUser={!!user} collapsed={false} />
          </div>
        </header>

        {view === "folder" ? (
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
            <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-1 text-sm">
              <button type="button" className="text-muted hover:text-accent" onClick={() => setParentId(null)}>
                Potion
              </button>
              {crumbs.map((c) => (
                <span key={c.id} className="flex items-center gap-1">
                  <span className="text-faint">/</span>
                  <button type="button" className="truncate text-muted hover:text-accent" onClick={() => setParentId(c.id)}>
                    {c.name}
                  </button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LayoutToggle layout={layout} onChange={setLayoutMode} />
              <button
                type="button"
                className="h-11 rounded-full border border-border px-4 text-sm"
                onClick={() => setMkdirOpen(true)}
              >
                New folder
              </button>
              <button
                type="button"
                title="Photos, videos, PDFs, zips — any file"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-4" strokeWidth={1.75} />
                {busy ? "Saving" : "Add files"}
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = "";
                  void upload(list);
                }}
              />
            </div>
          </header>
        ) : (
          <header className="border-b border-border px-4 py-4 md:px-6">
            <h1 className="font-serif text-2xl italic">{view === "apps" ? "Apps" : "Sync"}</h1>
          </header>
        )}

        <section
          className="flex-1 overflow-auto px-4 py-5 md:px-6"
          onDragOver={(e) => {
            e.preventDefault();
            if (view === "folder") setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (view === "folder") void upload(e.dataTransfer.files);
          }}
        >
          {!ready || isPending ? (
            <div className="h-40 animate-pulse rounded-xl bg-card" />
          ) : view === "sync" ? (
            <SyncPanel signedIn={!!user} mode={mode} />
          ) : view === "apps" ? (
            <AppsPanel
              apps={apps}
              space={space}
              onOpen={async (app) => {
                const id = app.folderId || (await api.ensureAppFolder(mode, app.name));
                setParentId(id);
                setView("folder");
              }}
              onAdd={async (name) => {
                try {
                  const made = await api.addConnectedApp(mode, name);
                  ping(`Added ${made.name} — look in Folder / Apps`);
                  await refresh();
                } catch (err) {
                  ping(err instanceof Error ? err.message : "Could not add app");
                }
              }}
              onRemove={async (name) => {
                await api.removeConnectedApp(name);
                ping(`Removed ${name}`);
                await refresh();
              }}
              onCopy={() => {
                void navigator.clipboard.writeText(space);
                ping("Copied Potion key");
              }}
            />
          ) : (
            <div className="flex flex-col gap-5">
              {module && activeApp ? (
                <AppModule
                  name={activeApp}
                  label={module.backupLabel}
                  files={backups}
                  restored={restored}
                  busy={busy}
                  onSave={() => void saveBackup()}
                  onRestore={(n) => void restore(n)}
                />
              ) : null}
              <FolderGrid
                layout={layout}
                mode={mode}
                items={items}
                over={over}
                selected={selected}
                menuFor={menuFor}
                onSelect={setSelected}
                onMenu={setMenuFor}
                onOpen={(n) => {
                  if (n.kind === "folder") setParentId(n.id);
                }}
                onPreview={(n) => {
                  const kind = fileKind(n.mime, n.name);
                  if (kind === "image" || kind === "video" || kind === "audio") setPreview(n);
                  else setSelected(n.id);
                }}
                onGet={(n) => void download(n)}
                onCopy={(n) => void copyItem(n)}
                onMove={(n) => void moveItem(n)}
                onShare={(n) => void shareItem(n)}
                onSync={(n) => void toggleSync(n)}
                onTrash={(n) => void deleteItem(n)}
              />
            </div>
          )}
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {(
          [
            ["folder", "Folder", Folder],
            ["apps", "Apps", Blocks],
            ["sync", "Sync", Cloud],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={cn(
              "flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs text-muted",
              view === id && "text-foreground",
            )}
          >
            <Icon className="size-5" strokeWidth={1.7} />
            {label}
          </button>
        ))}
      </nav>

      {mkdirOpen ? (
        <Modal onClose={() => setMkdirOpen(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const next = folderName.trim();
              if (!next) return;
              void (async () => {
                await api.mkdir(mode, parentId, next);
                setFolderName("");
                setMkdirOpen(false);
                await refresh();
              })();
            }}
          >
            <h3 className="font-serif text-2xl italic">New folder</h3>
            <input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              autoFocus
              placeholder="Name"
              className="h-11 w-full rounded-lg border border-border bg-background px-3"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="h-11 rounded-full border border-border px-4 text-sm" onClick={() => setMkdirOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={!folderName.trim()} className="h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60">
                Create
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {sheet ? <Modal onClose={() => setSheet(null)}>{sheet}</Modal> : null}

      {preview ? (
        <Modal onClose={() => setPreview(null)}>
          <PreviewSheet node={preview} mode={mode} onClose={() => setPreview(null)} onGet={() => void download(preview)} />
        </Modal>
      ) : null}

      {toast ? (
        <div className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground md:bottom-5">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
      <PotionMark className="size-9" />
      {collapsed ? (
        <span className="sr-only">Potion</span>
      ) : (
        <div>
          <p className="text-sm font-medium leading-tight">Potion</p>
          <p className="text-[11px] text-muted">{APP_VERSION_LABEL}</p>
        </div>
      )}
    </div>
  );
}

function ThemeToggle({ theme, onToggle, collapsed }: { theme: Theme; onToggle: () => void; collapsed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      className={cn(
        "flex h-11 items-center gap-3 rounded-lg text-sm text-muted hover:bg-elevated hover:text-foreground",
        collapsed ? "w-11 justify-center" : "w-full px-3",
      )}
    >
      {theme === "dark" ? <Sun className="size-4" strokeWidth={1.75} /> : <Moon className="size-4" strokeWidth={1.75} />}
      {collapsed ? <span className="sr-only">{theme === "dark" ? "Light mode" : "Dark mode"}</span> : <span>{theme === "dark" ? "Light" : "Dark"}</span>}
    </button>
  );
}

function AuthSlot({ isPending, hasUser, collapsed }: { isPending: boolean; hasUser: boolean; collapsed: boolean }) {
  if (isPending) return <div className="h-11 w-11 animate-pulse rounded-full bg-elevated" />;
  if (hasUser) return collapsed ? null : <UserButton />;
  return (
    <Link
      to="/login"
      title="Sign in"
      className={cn(
        "inline-flex h-11 items-center justify-center rounded-full border border-border text-sm",
        collapsed ? "w-11" : "px-4",
      )}
    >
      {collapsed ? <LogIn className="size-4" strokeWidth={1.75} /> : "Sign in"}
    </Link>
  );
}

function Nav({ view, setView, collapsed }: { view: View; setView: (v: View) => void; collapsed: boolean }) {
  return (
    <nav className="flex flex-col gap-1">
      {(
        [
          ["folder", "Folder", Folder],
          ["apps", "Apps", Blocks],
          ["sync", "Sync", Cloud],
        ] as const
      ).map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          title={label}
          onClick={() => setView(id)}
          className={cn(
            "flex h-11 items-center gap-3 rounded-lg text-sm text-muted",
            collapsed ? "justify-center" : "px-3 text-left",
            view === id && "bg-elevated text-foreground",
          )}
        >
          <Icon className="size-4 shrink-0" strokeWidth={1.75} />
          {collapsed ? <span className="sr-only">{label}</span> : label}
        </button>
      ))}
    </nav>
  );
}

function LayoutToggle({ layout, onChange }: { layout: Layout; onChange: (l: Layout) => void }) {
  const btn = "grid size-11 place-items-center rounded-full text-muted";
  return (
    <div className="flex rounded-full border border-border p-0.5">
      <button
        type="button"
        title="List"
        className={cn(btn, layout === "list" && "bg-elevated text-foreground")}
        onClick={() => onChange("list")}
      >
        <LayoutList className="size-4" strokeWidth={1.75} />
        <span className="sr-only">List</span>
      </button>
      <button
        type="button"
        title="Grid"
        className={cn(btn, layout === "grid" && "bg-elevated text-foreground")}
        onClick={() => onChange("grid")}
      >
        <LayoutGrid className="size-4" strokeWidth={1.75} />
        <span className="sr-only">Grid</span>
      </button>
    </div>
  );
}

function kindIcon(kind: ReturnType<typeof fileKind>, className: string) {
  const sw = 1.6;
  if (kind === "image") return <ImageIcon className={className} strokeWidth={sw} />;
  if (kind === "video") return <Film className={className} strokeWidth={sw} />;
  if (kind === "audio") return <Music className={className} strokeWidth={sw} />;
  if (kind === "zip") return <FileArchive className={className} strokeWidth={sw} />;
  if (kind === "pdf") return <FileText className={className} strokeWidth={sw} />;
  return <FileIcon className={className} strokeWidth={sw} />;
}

function NodeGlyph({ node, mode, layout }: { node: PotionNode; mode: StoreMode; layout: Layout }) {
  const [url, setUrl] = useState<string | null>(null);
  const kind = node.kind === "file" ? fileKind(node.mime, node.name) : null;
  const size = layout === "grid" ? "size-7" : "size-5";
  useEffect(() => {
    if (kind !== "image") return;
    let gone = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const file = await api.getFile(mode, node.id);
        if (!file || gone) return;
        objectUrl = URL.createObjectURL(new Blob([file.bytes], { type: file.mime || "image/*" }));
        setUrl(objectUrl);
      } catch {
        /* keep icon */
      }
    })();
    return () => {
      gone = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, mode, node.id]);
  if (node.kind === "folder") {
    if (node.name === "Apps") {
      return <Blocks className={cn("shrink-0 text-muted", size)} strokeWidth={1.6} />;
    }
    return <Folder className={cn("shrink-0 text-muted", size)} strokeWidth={1.6} />;
  }
  if (url) {
    return (
      <span
        className={cn(
          "shrink-0 overflow-hidden bg-elevated",
          layout === "grid" ? "size-12 rounded-lg" : "size-9 rounded-md",
        )}
      >
        <img src={url} alt="" className="size-full object-cover" />
      </span>
    );
  }
  return kindIcon(kind ?? "file", cn("shrink-0 text-muted", size));
}

function PreviewSheet({
  node,
  mode,
  onClose,
  onGet,
}: {
  node: PotionNode;
  mode: StoreMode;
  onClose: () => void;
  onGet: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const kind = fileKind(node.mime, node.name);
  useEffect(() => {
    let gone = false;
    let objectUrl: string | null = null;
    void (async () => {
      const file = await api.getFile(mode, node.id);
      if (!file || gone) return;
      objectUrl = URL.createObjectURL(new Blob([file.bytes], { type: file.mime || "application/octet-stream" }));
      setUrl(objectUrl);
    })();
    return () => {
      gone = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mode, node.id]);
  return (
    <div className="space-y-4">
      <h3 className="truncate font-serif text-2xl italic">{node.name}</h3>
      <p className="text-sm text-muted">{formatBytes(node.size)} · syncs with every other file in a Syncing folder</p>
      {url && kind === "image" ? (
        <img src={url} alt={node.name} className="max-h-80 w-full rounded-lg object-contain bg-elevated" />
      ) : null}
      {url && kind === "video" ? (
        <video src={url} controls className="max-h-80 w-full rounded-lg bg-elevated" />
      ) : null}
      {url && kind === "audio" ? <audio src={url} controls className="w-full" /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="h-11 rounded-full border border-border px-4 text-sm" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground"
          onClick={onGet}
        >
          Download
        </button>
      </div>
    </div>
  );
}

function FolderGrid({
  layout,
  mode,
  items,
  over,
  selected,
  menuFor,
  onSelect,
  onMenu,
  onOpen,
  onPreview,
  onGet,
  onCopy,
  onMove,
  onShare,
  onSync,
  onTrash,
}: {
  layout: Layout;
  mode: StoreMode;
  items: PotionNode[];
  over: boolean;
  selected: string | null;
  menuFor: string | null;
  onSelect: (id: string | null) => void;
  onMenu: (id: string | null) => void;
  onOpen: (n: PotionNode) => void;
  onPreview: (n: PotionNode) => void;
  onGet: (n: PotionNode) => void;
  onCopy: (n: PotionNode) => void;
  onMove: (n: PotionNode) => void;
  onShare: (n: PotionNode) => void;
  onSync: (n: PotionNode) => void;
  onTrash: (n: PotionNode) => void;
}) {
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuItem = items.find((i) => i.id === menuFor) ?? null;
  const anchor = menuFor ? btnRefs.current[menuFor] : null;

  useEffect(() => {
    if (!menuFor) return;
    const close = (e: MouseEvent) => {
      const node = e.target as Node;
      if (anchor?.contains(node)) return;
      const menu = document.getElementById("potion-action-menu");
      if (menu?.contains(node)) return;
      onMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor, anchor, onMenu]);

  if (items.length === 0) {
    return (
      <p className={cn("py-16 text-center text-muted", over && "rounded-xl outline-dashed outline-1 outline-accent")}>
        Empty. Add photos, videos, PDFs, zips — any file. Apps lives here too.
      </p>
    );
  }
  const current = items.find((i) => i.id === selected) ?? null;
  return (
    <div className="flex flex-col gap-3">
      {current ? (
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-card p-2 shadow-[var(--shadow-border)]">
          <p className="min-w-0 flex-1 truncate px-2 text-sm font-medium">{current.name}</p>
          <ExplorerButtons node={current} onGet={onGet} onCopy={onCopy} onMove={onMove} onShare={onShare} onSync={onSync} onTrash={onTrash} />
        </div>
      ) : null}
      <ul
        className={cn(
          layout === "grid"
            ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
            : "flex flex-col gap-1",
          over && "rounded-xl outline-dashed outline-1 outline-accent",
        )}
      >
        {items.map((item) => {
          const on = selected === item.id;
          const kind = item.kind === "file" ? fileKind(item.mime, item.name) : null;
          const meta =
            item.kind === "folder"
              ? item.synced === false
                ? "Not syncing"
                : "Syncing"
              : `${kind === "image" ? "Photo" : kind === "video" ? "Video" : kind === "audio" ? "Audio" : kind === "pdf" ? "PDF" : kind === "zip" ? "Archive" : "File"} · ${formatBytes(item.size)}`;
          return (
            <li key={item.id}>
              <article
                className={cn(
                  "rounded-xl bg-card shadow-[var(--shadow-border)]",
                  on && "ring-2 ring-foreground/30",
                  layout === "grid"
                    ? "relative flex min-h-32 flex-col overflow-visible p-3"
                    : "flex items-center gap-2 px-3 py-1.5",
                )}
              >
                <button
                  type="button"
                  className={cn(
                    "min-w-0 text-left",
                    layout === "grid"
                      ? "flex flex-1 flex-col items-start gap-2 pr-8"
                      : "flex min-h-11 flex-1 items-center gap-3",
                  )}
                  onClick={() => {
                    onMenu(null);
                    if (item.kind === "folder") onOpen(item);
                    else onPreview(item);
                  }}
                >
                  <NodeGlyph node={item} mode={mode} layout={layout} />
                  <span className="min-w-0 w-full">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-faint">{meta}</p>
                  </span>
                  {layout === "list" && item.kind === "folder" ? (
                    item.synced === false ? (
                      <CloudOff className="size-3.5 shrink-0 text-faint" strokeWidth={1.75} />
                    ) : (
                      <Cloud className="size-3.5 shrink-0 text-faint" strokeWidth={1.75} />
                    )
                  ) : null}
                </button>
                <button
                  ref={(el) => {
                    btnRefs.current[item.id] = el;
                  }}
                  type="button"
                  title="Actions"
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-foreground",
                    layout === "grid" && "absolute top-1 right-1",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(item.id);
                    onMenu(menuFor === item.id ? null : item.id);
                  }}
                >
                  <MoreHorizontal className="size-4" strokeWidth={1.75} />
                </button>
              </article>
            </li>
          );
        })}
      </ul>
      {menuItem && anchor
        ? createPortal(
            <ActionMenu
              item={menuItem}
              anchor={anchor}
              onOpen={onOpen}
              onGet={onGet}
              onCopy={onCopy}
              onMove={onMove}
              onShare={onShare}
              onSync={onSync}
              onTrash={onTrash}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function ActionMenu({
  item,
  anchor,
  onOpen,
  onGet,
  onCopy,
  onMove,
  onShare,
  onSync,
  onTrash,
}: {
  item: PotionNode;
  anchor: HTMLButtonElement;
  onOpen: (n: PotionNode) => void;
  onGet: (n: PotionNode) => void;
  onCopy: (n: PotionNode) => void;
  onMove: (n: PotionNode) => void;
  onShare: (n: PotionNode) => void;
  onSync: (n: PotionNode) => void;
  onTrash: (n: PotionNode) => void;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const width = 192;
    const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
    const top = Math.min(r.bottom + 4, window.innerHeight - 280);
    setPos({ top, left });
  }, [anchor]);
  return (
    <div
      id="potion-action-menu"
      role="menu"
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-50 w-48 rounded-xl bg-card p-1 shadow-[var(--shadow-border)]"
    >
      {item.kind === "folder" ? (
        <MenuRow label="Open" onClick={() => onOpen(item)} />
      ) : (
        <MenuRow label="Download" onClick={() => onGet(item)} />
      )}
      <MenuRow label="Make a copy" onClick={() => onCopy(item)} />
      <MenuRow label="Move" onClick={() => onMove(item)} />
      <MenuRow label="Share" onClick={() => onShare(item)} />
      {item.kind === "folder" ? (
        <MenuRow label={item.synced === false ? "Sync folder" : "Don't sync"} onClick={() => onSync(item)} />
      ) : null}
      <MenuRow label="Delete" onClick={() => onTrash(item)} danger />
    </div>
  );
}

function ExplorerButtons({
  node,
  onGet,
  onCopy,
  onMove,
  onShare,
  onSync,
  onTrash,
}: {
  node: PotionNode;
  onGet: (n: PotionNode) => void;
  onCopy: (n: PotionNode) => void;
  onMove: (n: PotionNode) => void;
  onShare: (n: PotionNode) => void;
  onSync: (n: PotionNode) => void;
  onTrash: (n: PotionNode) => void;
}) {
  const btn = "grid size-11 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-foreground";
  return (
    <>
      {node.kind === "file" ? (
        <button type="button" title="Download" className={btn} onClick={() => onGet(node)}>
          <FileText className="size-4" strokeWidth={1.75} />
        </button>
      ) : (
        <button type="button" title={node.synced === false ? "Sync folder" : "Don't sync"} className={btn} onClick={() => onSync(node)}>
          {node.synced === false ? <CloudOff className="size-4" strokeWidth={1.75} /> : <Cloud className="size-4" strokeWidth={1.75} />}
        </button>
      )}
      <button type="button" title="Make a copy" className={btn} onClick={() => onCopy(node)}>
        <Copy className="size-4" strokeWidth={1.75} />
      </button>
      <button type="button" title="Move" className={btn} onClick={() => onMove(node)}>
        <FolderInput className="size-4" strokeWidth={1.75} />
      </button>
      <button type="button" title="Share" className={btn} onClick={() => onShare(node)}>
        <Share2 className="size-4" strokeWidth={1.75} />
      </button>
      <button type="button" title="Delete" className={btn} onClick={() => onTrash(node)}>
        <Trash2 className="size-4" strokeWidth={1.75} />
      </button>
    </>
  );
}

function MenuRow({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-11 w-full items-center rounded-lg px-3 text-left text-sm",
        danger ? "text-destructive hover:bg-elevated" : "text-foreground hover:bg-elevated",
      )}
    >
      {label}
    </button>
  );
}

function MoveSheet({
  name,
  targets,
  onPick,
  onClose,
}: {
  name: string;
  targets: { id: string | null; name: string; path: string }[];
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-serif text-2xl italic">Move {name}</h3>
      <p className="text-sm text-muted">Pick a folder. Same idea as Drive — the file changes house, it is not copied.</p>
      <ul className="max-h-64 space-y-1 overflow-auto">
        {targets.map((t) => (
          <li key={t.id ?? "root"}>
            <button
              type="button"
              onClick={() => onPick(t.id)}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-elevated"
            >
              <Folder className="size-4 text-muted" strokeWidth={1.6} />
              <span className="truncate">{t.path}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <button type="button" className="h-11 rounded-full border border-border px-4 text-sm" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ShareSheet({
  name,
  url,
  onCopy,
  onClose,
}: {
  name: string;
  url: string;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-serif text-2xl italic">Share {name}</h3>
      <p className="text-sm text-muted">Anyone with the link can view. No Google account needed on their side.</p>
      <div className="flex items-center gap-2 rounded-xl bg-elevated p-2">
        <code className="min-w-0 flex-1 truncate px-2 font-mono text-xs">{url}</code>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-11 items-center gap-1 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground"
        >
          <Link2 className="size-3.5" strokeWidth={1.75} />
          Copy link
        </button>
      </div>
      <div className="flex justify-end">
        <button type="button" className="h-11 rounded-full border border-border px-4 text-sm" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function AppModule({
  name,
  label,
  files,
  restored,
  busy,
  onSave,
  onRestore,
}: {
  name: string;
  label: string;
  files: PotionNode[];
  restored: RestoreRecord | null;
  busy: boolean;
  onSave: () => void;
  onRestore: (n: PotionNode) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-widest text-muted">{name}</p>
      <p className="mt-1 text-sm text-muted">This app drops files here. Potion only carries them.</p>
      {restored ? (
        <p className="mt-3 text-sm">
          Last hand-off: <span className="font-medium">{restored.fileName}</span>
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={onSave}
        className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60"
      >
        <Save className="size-4" strokeWidth={1.75} />
        {label}
      </button>
      {files.length ? (
        <ul className="mt-4 space-y-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-elevated px-3 py-2">
              <span className="min-w-0 truncate text-sm">{f.name}</span>
              <button
                type="button"
                className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm text-muted hover:text-foreground"
                onClick={() => onRestore(f)}
              >
                <RotateCcw className="size-3.5" strokeWidth={1.75} />
                Open in app
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AppsPanel({
  apps,
  space,
  onOpen,
  onAdd,
  onRemove,
  onCopy,
}: {
  apps: ConnectedApp[];
  space: string;
  onOpen: (app: ConnectedApp) => void;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  onCopy: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <p className="text-sm text-muted">
        No stock apps. Type a name. Potion makes a folder inside <span className="text-foreground">Apps</span>.
        That Apps folder lives in Folder — open it to manage the files. Remove a name from this list anytime —
        the folder stays until you delete it.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const next = name.trim();
          if (!next) return;
          onAdd(next);
          setName("");
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="App name"
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-sm"
        />
        <button
          type="submit"
          className="inline-flex h-11 items-center gap-1 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground"
        >
          <Plus className="size-4" strokeWidth={1.75} />
          Add
        </button>
      </form>
      <div className="rounded-xl bg-card px-4 py-3 shadow-[var(--shadow-border)]">
        <p className="text-xs text-muted">Potion key for the next vibe app. Not a login.</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate font-mono text-sm">{space}</code>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex h-11 items-center gap-1 rounded-full border border-border px-3 text-sm"
          >
            <Copy className="size-3.5" strokeWidth={1.75} />
            Copy
          </button>
        </div>
      </div>
      {apps.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Empty list. Add one above.</p>
      ) : (
        <ul className="space-y-2">
          {apps.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 shadow-[var(--shadow-border)]">
              <button
                type="button"
                onClick={() => onOpen(a)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
              >
                <Blocks className="size-5 text-muted" strokeWidth={1.6} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-faint">{a.files ? `${a.files} files` : "Folder"}</p>
                </div>
              </button>
              <button
                type="button"
                title="Remove from list"
                className="grid size-11 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-destructive"
                onClick={() => onRemove(a.name)}
              >
                <Trash2 className="size-4" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SyncPanel({ signedIn, mode }: { signedIn: boolean; mode: StoreMode }) {
  const [job, setJob] = useState<SyncState>(() => ({
    status: "idle",
    progress: 0,
    done: 0,
    total: 0,
    current: "Idle",
    error: null,
    skipped: 0,
  }));
  useEffect(() => subscribeSync(setJob), []);
  const running = job.status === "running";
  const paused = job.status === "paused";
  const btn =
    "inline-flex h-11 items-center gap-2 rounded-full border border-border px-4 text-sm disabled:opacity-40";
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 text-sm text-muted">
      <section className="space-y-4 rounded-2xl bg-card p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-foreground">Sync</h2>
        <p>
          Start walks folders marked Syncing. Pause holds the line. Stop clears it. Retry starts over.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(btn, (running || paused) && "bg-accent text-accent-foreground border-transparent")}
            disabled={running}
            onClick={() => void startSync(mode)}
          >
            <Play className="size-3.5" strokeWidth={1.75} />
            {paused ? "Resume" : "Start"}
          </button>
          <button type="button" className={btn} disabled={!running} onClick={pauseSync}>
            <Pause className="size-3.5" strokeWidth={1.75} />
            Pause
          </button>
          <button type="button" className={btn} disabled={job.status === "idle" || job.status === "stopped"} onClick={stopSync}>
            <Square className="size-3.5" strokeWidth={1.75} />
            Stop
          </button>
          <button
            type="button"
            className={btn}
            disabled={running}
            onClick={() => void retrySync(mode)}
          >
            <RotateCcw className="size-3.5" strokeWidth={1.75} />
            Retry
          </button>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-elevated">
          <div className="h-full bg-accent" style={{ width: `${job.progress}%` }} />
        </div>
        <p className="font-mono text-xs text-foreground">
          {job.status} · {job.done}/{job.total} · {job.current}
        </p>
        {job.error ? <p className="text-sm text-destructive">{job.error}</p> : null}
      </section>
      <section className="space-y-3 rounded-2xl bg-card p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-foreground">How to use it</h2>
        <ol className="list-decimal space-y-2 pl-4">
          <li>
            <span className="text-foreground">Folder</span> is the box. Drop photos, videos, music, PDFs, zips,
            docs — every file type. Same as Dropbox, without the bill.
          </li>
          <li>
            <span className="text-foreground">Apps</span> is not a second box. It is a real folder named Apps
            inside Folder. Add a name here (Finance Manager, Atrium, …) and Potion makes that subfolder for
            the other app to park backups. Open the name to jump there.
          </li>
          <li>
            <span className="text-foreground">Sync</span> is the copy button, not another place for files.
            Start copies every file in folders marked Syncing — pictures included. Pause holds. Stop clears.
            Retry starts over. A folder set to “Don’t sync” is skipped.
          </li>
          <li>
            No account: files stay on <span className="text-foreground">this</span> phone or computer.
          </li>
          <li>
            Sign in, then Start: this device pushes into your locker and the locker pulls onto this device.
            Same key on another phone or PC = same files.
          </li>
        </ol>
        <p className="flex items-start gap-2 pt-1">
          <Smartphone className="mt-0.5 size-4 shrink-0 text-faint" strokeWidth={1.75} />
          <span>
            The phone app is not a duplicate of Sync. It is another window on the same box. Use Folder to
            manage files on the phone, Apps for other apps’ folders, Sync when you want the locker copy.
          </span>
        </p>
      </section>
      <p className="font-serif text-3xl italic text-foreground">Like a lunchbox.</p>
      <p>
        Potion is a box for files. You can use it on the web, on a phone, or on a computer. Same box.
      </p>
      <section className="space-y-2 rounded-2xl bg-card p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-foreground">You do not need an account</h2>
        <p>
          Skip sign-in and the box stays glued to <span className="text-foreground">this</span> browser.
        </p>
      </section>
      <section className="space-y-2 rounded-2xl bg-card p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-foreground">Sign-in is a locker key</h2>
        <p>Same key on two devices = same locker. Nothing copies until you sign in on the other device too.</p>
        <p className="text-foreground">{signedIn ? "You have a key. This is the account folder." : "You have no key yet. This is this-device only."}</p>
        {!signedIn ? (
          <Link to="/login" className="mt-2 inline-flex h-11 items-center rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground">
            Get a key (optional)
          </Link>
        ) : null}
      </section>
    </div>
  );
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-background/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5">{children}</div>
    </div>
  );
}
