import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import {
  Folder,
  FileText,
  Upload,
  Trash2,
  RotateCcw,
  Cloud,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeft,
  LogIn,
  MoreHorizontal,
  Link2,
  Play,
  Pause,
  Square,
  LayoutList,
  LayoutGrid,
  Image as ImageIcon,
  Film,
  Music,
  FileArchive,
  File as FileIcon,
  Smartphone,
  Search,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { PotionMark } from "@/components/potion-mark";
import { APP_VERSION_LABEL } from "@/lib/version";
import { readTheme, writeTheme, type Theme } from "@/lib/theme";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import * as api from "@/lib/potion-api";
import type { PotionNode, StoreMode } from "@/lib/potion-api";
import {
  formatBytes,
  formatWhen,
  cn,
  fileKind,
  kindLabel,
  typeLabel,
  sortNodes,
  type SortKey,
  type SortDir,
} from "@/lib/utils";
import {
  maybeAutoSync,
  pauseSync,
  retrySync,
  startSync,
  stopSync,
  subscribeSync,
  type SyncState,
} from "@/lib/potion-sync";
import { subscribePotion } from "@/lib/potion-watch";
import type { PotionComment, PotionVersion } from "@/lib/potion-api";

type View = "folder" | "trash" | "sync";
type Layout = "list" | "grid";

const SORT_LABEL: Record<SortKey, string> = {
  name: "Name",
  date: "Date modified",
  type: "Type",
  size: "Size",
};

const THUMB_MAX = 1_500_000;
const thumbs = new Map<string, string>();

export function PotionApp() {
  const { user, isPending } = useCurrentUserState();
  const mode: StoreMode = user ? "cloud" : "local";
  const [view, setView] = useState<View>("folder");
  const [parentId, setParentId] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<PotionNode[]>([]);
  const [items, setItems] = useState<PotionNode[]>([]);
  const [trashItems, setTrashItems] = useState<PotionNode[]>([]);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<ReactNode>(null);
  const [over, setOver] = useState(false);
  const [ready, setReady] = useState(false);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [theme, setTheme] = useState<Theme>("dark");
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>("list");
  const [preview, setPreview] = useState<PotionNode | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [used, setUsed] = useState(0);
  const [renameFor, setRenameFor] = useState<PotionNode | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyNote, setBusyNote] = useState("");
  const [liveAt, setLiveAt] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef(0);
  const lastClick = useRef<string | null>(null);

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

  function setSort(next: SortKey) {
    const dir: SortDir = sortKey === next && sortDir === "asc" ? "desc" : "asc";
    setSortKey(next);
    setSortDir(dir);
    try {
      localStorage.setItem("potion-sort", `${next}:${dir}`);
    } catch {
      /* ignore */
    }
  }

  const refresh = useCallback(async (opts?: { quiet?: boolean }) => {
    if (isPending) return;
    await api.ensurePotion(mode);
    if (view === "trash") {
      setTrashItems(await api.listTrash(mode));
    } else if (search) {
      setItems(await api.searchNodes(mode, search));
    } else {
      setItems(await api.listNodes(mode, parentId));
    }
    const path = await api.pathOf(mode, parentId);
    setCrumbs(path);
    if (!opts?.quiet) {
      setSelected([]);
      setMenuFor(null);
    }
    try {
      setUsed(await api.usedBytes(mode));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, [mode, parentId, isPending, search, view]);

  useEffect(() => {
    void refresh().catch(() => setReady(true));
  }, [refresh]);

  useEffect(() => {
    const unsub = subscribePotion(() => {
      setLiveAt(Date.now());
      void refresh({ quiet: true });
    });
    const poll = window.setInterval(() => {
      if (mode === "cloud") void refresh({ quiet: true });
    }, 8000);
    return () => {
      unsub();
      window.clearInterval(poll);
    };
  }, [refresh, mode]);

  useEffect(() => {
    const wait = query.trim() ? 200 : 0;
    const t = window.setTimeout(() => setSearch(query.trim()), wait);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const t = readTheme();
    setTheme(t);
    writeTheme(t);
    try {
      setCollapsed(localStorage.getItem("potion-rail") === "1");
      setLayout(localStorage.getItem("potion-layout") === "grid" ? "grid" : "list");
      const raw = localStorage.getItem("potion-sort") || "";
      const [k, d] = raw.split(":");
      if (k === "name" || k === "date" || k === "type" || k === "size") setSortKey(k);
      if (d === "asc" || d === "desc") setSortDir(d);
    } catch {
      /* ignore */
    }
  }, []);

  const shown = useMemo(() => sortNodes(view === "trash" ? trashItems : items, sortKey, sortDir), [items, trashItems, view, sortKey, sortDir]);

  async function upload(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setBusyNote("Saving");
    try {
      await api.putFiles(mode, parentId, Array.from(files), (p) => {
        const pct = p.total ? Math.round((p.done / p.total) * 100) : 100;
        setBusyNote(p.total > 1 ? `Saving ${pct}% · ${p.name}` : `Saving ${pct}%`);
      });
      ping(`Added ${files.length} file${files.length === 1 ? "" : "s"}`);
      await refresh();
      maybeAutoSync(mode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not add files";
      ping(msg);
    } finally {
      setBusy(false);
      setBusyNote("");
    }
  }

  async function download(node: PotionNode) {
    const file = await api.getFile(mode, node.id);
    if (!file) return;
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function copyItem(node: PotionNode) {
    try {
      await api.copyNode(mode, node.id, node.parentId);
      ping(`Copied ${node.name}`);
      setMenuFor(null);
      await refresh();
    } catch (err) {
      ping(err instanceof Error ? err.message : "Could not copy");
    }
  }

  async function deleteItem(node: PotionNode) {
    await trashMany([node]);
  }

  async function trashMany(nodes: PotionNode[]) {
    if (!nodes.length) return;
    setBusy(true);
    try {
      for (const n of nodes) await api.trashNode(mode, n.id);
      ping(nodes.length === 1 ? `Moved ${nodes[0].name} to trash` : `Moved ${nodes.length} items to trash`);
      setMenuFor(null);
      await refresh();
    } catch (err) {
      ping(err instanceof Error ? err.message : "Could not move to trash");
    } finally {
      setBusy(false);
    }
  }

  async function toggleSync(node: PotionNode) {
    try {
      const next = node.synced === false;
      await api.setSynced(mode, node.id, next);
      ping(next ? `Syncing ${node.name}` : `${node.name} is skipped on Start`);
      setMenuFor(null);
      await refresh();
    } catch (err) {
      ping(err instanceof Error ? err.message : "Could not update sync");
    }
  }

  async function shareItem(node: PotionNode) {
    try {
      const share = await api.shareNode(mode, node.id);
      const url = `${window.location.origin}/s/${share.token}`;
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
    } catch (err) {
      ping(err instanceof Error ? err.message : "Could not share");
    }
  }

  async function moveItem(node: PotionNode) {
    try {
      const targets = await api.listFolderTargets(mode, node.kind === "folder" ? node.id : undefined);
      setMenuFor(null);
      setSheet(
        <MoveSheet
          name={node.name}
          targets={targets}
          onPick={async (dest) => {
            try {
              await api.moveNode(mode, node.id, dest);
              ping(`Moved ${node.name}`);
              setSheet(null);
              await refresh();
            } catch (err) {
              ping(err instanceof Error ? err.message : "Could not move");
            }
          }}
          onClose={() => setSheet(null)}
        />,
      );
    } catch (err) {
      ping(err instanceof Error ? err.message : "Could not move");
    }
  }

  function openRename(node: PotionNode) {
    setMenuFor(null);
    setRenameFor(node);
    setRenameValue(node.name);
  }

  async function openHistory(node: PotionNode) {
    setMenuFor(null);
    try {
      const versions = await api.listVersions(mode, node.id);
      setSheet(
        <HistorySheet
          name={node.name}
          versions={versions}
          onRestore={async (version) => {
            try {
              await api.revertNode(mode, node.id, version);
              ping(`Restored version ${version}`);
              setSheet(null);
              await refresh();
            } catch (err) {
              ping(err instanceof Error ? err.message : "Could not restore version");
            }
          }}
          onClose={() => setSheet(null)}
        />,
      );
    } catch (err) {
      ping(err instanceof Error ? err.message : "Could not load history");
    }
  }

  async function openComments(node: PotionNode) {
    setMenuFor(null);
    try {
      const rows = await api.listComments(mode, node.id);
      setSheet(
        <CommentsSheet
          name={node.name}
          comments={rows}
          onPost={async (body) => {
            const row = await api.addComment(mode, node.id, body);
            ping("Comment added");
            return row;
          }}
          onClose={() => setSheet(null)}
        />,
      );
    } catch (err) {
      ping(err instanceof Error ? err.message : "Could not load comments");
    }
  }

  async function commitRename() {
    if (!renameFor) return;
    const next = renameValue.trim();
    if (!next || next === renameFor.name) {
      setRenameFor(null);
      return;
    }
    try {
      await api.renameNode(mode, renameFor.id, next);
      ping(`Renamed to ${next}`);
      setRenameFor(null);
      await refresh();
    } catch (err) {
      ping(err instanceof Error ? err.message : "Could not rename");
    }
  }

  function pick(node: PotionNode, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
    const ids = shown.map((n) => n.id);
    if (e.shiftKey && lastClick.current) {
      const a = ids.indexOf(lastClick.current);
      const b = ids.indexOf(node.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(ids.slice(lo, hi + 1));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setSelected((cur) => (cur.includes(node.id) ? cur.filter((id) => id !== node.id) : [...cur, node.id]));
      lastClick.current = node.id;
      return;
    }
    setSelected([node.id]);
    lastClick.current = node.id;
  }

  const selectedNodes = shown.filter((n) => selected.includes(n.id));
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const viewRef = useRef(view);
  viewRef.current = view;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const viewNow = viewRef.current;
      const shownNow = shownRef.current;
      const selectedNow = shownNow.filter((n) => selectedRef.current.includes(n.id));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && viewNow === "folder") {
        e.preventDefault();
        setSelected(shownNow.map((n) => n.id));
      }
      if (e.key === "Delete" && viewNow === "folder" && selectedNow.length) {
        e.preventDefault();
        void (async () => {
          for (const n of selectedNow) await api.trashNode(mode, n.id);
          ping(selectedNow.length === 1 ? `Moved ${selectedNow[0].name} to trash` : `Moved ${selectedNow.length} items to trash`);
          await refresh();
        })();
      }
      if (e.key === "F2" && selectedNow[0]) {
        e.preventDefault();
        setMenuFor(null);
        setRenameFor(selectedNow[0]);
        setRenameValue(selectedNow[0].name);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, refresh]);

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
          {collapsed ? null : (
            <p className="px-3 pb-2 font-mono text-xs text-faint tabular-nums">
              {formatBytes(used)} {mode === "cloud" ? "in your account" : "on this device"}
            </p>
          )}
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

        {view === "sync" ? (
          <header className="border-b border-border px-4 py-4 md:px-6">
            <h1 className="font-serif text-2xl italic">Sync</h1>
          </header>
        ) : view === "trash" ? (
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
            <h1 className="font-serif text-2xl italic">Trash</h1>
            <button
              type="button"
              className="h-11 rounded-full border border-border px-4 text-sm disabled:opacity-40"
              disabled={trashItems.length === 0}
              onClick={() => {
                void (async () => {
                  try {
                    await api.emptyTrash(mode);
                    ping("Trash emptied");
                    await refresh();
                  } catch (err) {
                    ping(err instanceof Error ? err.message : "Could not empty trash");
                  }
                })();
              }}
            >
              Empty trash
            </button>
          </header>
        ) : (
          <header className="flex flex-col gap-3 border-b border-border px-4 py-3 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-1 text-sm">
                <button type="button" className="text-muted hover:text-accent" onClick={() => { setParentId(null); setQuery(""); }}>
                  Potion
                </button>
                {query.trim() ? (
                  <span className="flex items-center gap-1">
                    <span className="text-faint">/</span>
                    <span className="text-foreground">Search</span>
                  </span>
                ) : (
                  crumbs.map((c) => (
                    <span key={c.id} className="flex items-center gap-1">
                      <span className="text-faint">/</span>
                      <button type="button" className="truncate text-muted hover:text-accent" onClick={() => setParentId(c.id)}>
                        {c.name}
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <LayoutToggle layout={layout} onChange={setLayoutMode} />
                <LivePill at={liveAt} />
                <button type="button" className="h-11 rounded-full border border-border px-4 text-sm" onClick={() => setMkdirOpen(true)}>
                  New folder
                </button>
                <button
                  type="button"
                  title="Photos, videos, PDFs, zips — any size"
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="size-4" strokeWidth={1.75} />
                  {busy ? busyNote || "Saving" : "Add files"}
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
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-48 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" strokeWidth={1.75} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search Potion"
                  className="h-11 w-full rounded-full border border-border bg-background pl-10 pr-4 text-sm"
                />
              </label>
              {layout === "grid" ? <SortMenu sortKey={sortKey} sortDir={sortDir} onSort={setSort} /> : null}
            </div>
            {selected.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-foreground">{selected.length} selected</p>
                <button
                  type="button"
                  className="h-11 rounded-full border border-border px-4 text-sm"
                  onClick={() => {
                    for (const n of selectedNodes) if (n.kind === "file") void download(n);
                  }}
                >
                  Download
                </button>
                <button
                  type="button"
                  className="h-11 rounded-full border border-destructive/40 px-4 text-sm text-destructive"
                  onClick={() => void trashMany(selectedNodes)}
                >
                  Move to trash
                </button>
                <button type="button" className="h-11 rounded-full px-3 text-sm text-muted" onClick={() => setSelected([])}>
                  Clear
                </button>
              </div>
            ) : null}
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
            <SyncPanel signedIn={!!user} mode={mode} used={used} />
          ) : (
            <FolderGrid
              layout={layout}
              mode={mode}
              view={view}
              items={shown}
              over={over}
              selected={selected}
              menuFor={menuFor}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={setSort}
              onPick={pick}
              onMenu={setMenuFor}
              onOpen={(n) => {
                if (view === "trash") return;
                if (n.kind === "folder") {
                  setQuery("");
                  setParentId(n.id);
                }
              }}
              onPreview={(n) => {
                if (view === "trash") return;
                const kind = fileKind(n.mime, n.name);
                if (kind === "image" || kind === "video" || kind === "audio") setPreview(n);
                else setSelected([n.id]);
              }}
              onGet={(n) => void download(n)}
              onCopy={(n) => void copyItem(n)}
              onMove={(n) => void moveItem(n)}
              onShare={(n) => void shareItem(n)}
              onSync={(n) => void toggleSync(n)}
              onHistory={(n) => void openHistory(n)}
              onComments={(n) => void openComments(n)}
              onTrash={(n) => void deleteItem(n)}
              onRename={openRename}
              onRestore={async (n) => {
                try {
                  await api.restoreNode(mode, n.id);
                  ping(`Restored ${n.name}`);
                  await refresh();
                } catch (err) {
                  ping(err instanceof Error ? err.message : "Could not restore");
                }
              }}
              onPurge={async (n) => {
                try {
                  await api.purgeNode(mode, n.id);
                  ping(`Deleted ${n.name} forever`);
                  await refresh();
                } catch (err) {
                  ping(err instanceof Error ? err.message : "Could not delete");
                }
              }}
            />
          )}
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {(
          [
            ["folder", "Folder", Folder],
            ["trash", "Trash", Trash2],
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
                try {
                  await api.mkdir(mode, parentId, next);
                  setFolderName("");
                  setMkdirOpen(false);
                  await refresh();
                } catch (err) {
                  ping(err instanceof Error ? err.message : "Could not create folder");
                }
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

      {renameFor ? (
        <Modal onClose={() => setRenameFor(null)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void commitRename();
            }}
          >
            <h3 className="font-serif text-2xl italic">Rename</h3>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              className="h-11 w-full rounded-lg border border-border bg-background px-3"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="h-11 rounded-full border border-border px-4 text-sm" onClick={() => setRenameFor(null)}>
                Cancel
              </button>
              <button type="submit" disabled={!renameValue.trim()} className="h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60">
                Save
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
          <p className="text-xs text-muted">{APP_VERSION_LABEL}</p>
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
          ["trash", "Trash", Trash2],
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
      <button type="button" title="List" className={cn(btn, layout === "list" && "bg-elevated text-foreground")} onClick={() => onChange("list")}>
        <LayoutList className="size-4" strokeWidth={1.75} />
        <span className="sr-only">List</span>
      </button>
      <button type="button" title="Grid" className={cn(btn, layout === "grid" && "bg-elevated text-foreground")} onClick={() => onChange("grid")}>
        <LayoutGrid className="size-4" strokeWidth={1.75} />
        <span className="sr-only">Grid</span>
      </button>
    </div>
  );
}

function SortGlyph({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return null;
  return dir === "asc" ? <ArrowUp className="size-3.5" strokeWidth={1.75} /> : <ArrowDown className="size-3.5" strokeWidth={1.75} />;
}

function SortMenu({ sortKey, sortDir, onSort }: { sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-full border border-border p-0.5">
      {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onSort(k)}
          className={cn(
            "inline-flex h-10 items-center gap-1 rounded-full px-3 text-xs",
            sortKey === k ? "bg-elevated text-foreground" : "text-muted",
          )}
        >
          {SORT_LABEL[k]}
          <SortGlyph active={sortKey === k} dir={sortDir} />
        </button>
      ))}
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
  const [url, setUrl] = useState<string | null>(() => thumbs.get(node.id) ?? null);
  const kind = node.kind === "file" ? fileKind(node.mime, node.name) : null;
  const size = layout === "grid" ? "size-7" : "size-5";
  useEffect(() => {
    if (kind !== "image" || layout !== "grid" || node.size > THUMB_MAX) return;
    const cached = thumbs.get(node.id);
    if (cached) {
      setUrl(cached);
      return;
    }
    let gone = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const file = await api.getFile(mode, node.id);
        if (!file || gone) return;
        objectUrl = URL.createObjectURL(file.blob);
        if (gone) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        thumbs.set(node.id, objectUrl);
        setUrl(objectUrl);
      } catch {
        /* keep icon */
      }
    })();
    return () => {
      gone = true;
    };
  }, [kind, mode, node.id, node.size, layout]);
  if (node.kind === "folder") {
    return <Folder className={cn("shrink-0 text-muted", size)} strokeWidth={1.6} />;
  }
  if (url) {
    return (
      <span className="size-12 shrink-0 overflow-hidden rounded-lg bg-elevated">
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
      objectUrl = URL.createObjectURL(file.blob);
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
      <p className="text-sm text-muted">
        {kindLabel(kind)} · {formatBytes(node.size)} · {formatWhen(node.updatedAt)}
      </p>
      {url && kind === "image" ? <img src={url} alt={node.name} className="max-h-80 w-full rounded-lg bg-elevated object-contain" /> : null}
      {url && kind === "video" ? <video src={url} controls className="max-h-80 w-full rounded-lg bg-elevated" /> : null}
      {url && kind === "audio" ? <audio src={url} controls className="w-full" /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="h-11 rounded-full border border-border px-4 text-sm" onClick={onClose}>
          Close
        </button>
        <button type="button" className="h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground" onClick={onGet}>
          Download
        </button>
      </div>
    </div>
  );
}

function FolderGrid({
  layout,
  mode,
  view,
  items,
  over,
  selected,
  menuFor,
  sortKey,
  sortDir,
  onSort,
  onPick,
  onMenu,
  onOpen,
  onPreview,
  onGet,
  onCopy,
  onMove,
  onShare,
  onSync,
  onHistory,
  onComments,
  onTrash,
  onRename,
  onRestore,
  onPurge,
}: {
  layout: Layout;
  mode: StoreMode;
  view: View;
  items: PotionNode[];
  over: boolean;
  selected: string[];
  menuFor: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  onPick: (n: PotionNode, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
  onMenu: (id: string | null) => void;
  onOpen: (n: PotionNode) => void;
  onPreview: (n: PotionNode) => void;
  onGet: (n: PotionNode) => void;
  onCopy: (n: PotionNode) => void;
  onMove: (n: PotionNode) => void;
  onShare: (n: PotionNode) => void;
  onSync: (n: PotionNode) => void;
  onHistory: (n: PotionNode) => void;
  onComments: (n: PotionNode) => void;
  onTrash: (n: PotionNode) => void;
  onRename: (n: PotionNode) => void;
  onRestore: (n: PotionNode) => void;
  onPurge: (n: PotionNode) => void;
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
        {view === "trash" ? "Trash is empty." : "Empty. Drop photos, videos, PDFs, zips — any size."}
      </p>
    );
  }

  const cols: { key: SortKey; className: string }[] = [
    { key: "name", className: "min-w-0 flex-1 text-left" },
    { key: "date", className: "hidden w-44 shrink-0 text-left md:block" },
    { key: "type", className: "hidden w-32 shrink-0 text-left lg:block" },
    { key: "size", className: "hidden w-24 shrink-0 text-right md:block" },
  ];

  return (
    <div className="flex flex-col gap-3">
      {layout === "list" ? (
        <div className="flex items-center gap-2 px-3 text-xs text-muted">
          <span className="size-5 shrink-0" />
          {cols.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onSort(c.key)}
              className={cn("inline-flex h-9 items-center gap-1 hover:text-foreground", c.className)}
            >
              {SORT_LABEL[c.key]}
              <SortGlyph active={sortKey === c.key} dir={sortDir} />
            </button>
          ))}
          <span className="w-11 shrink-0" />
        </div>
      ) : null}
      <ul
        className={cn(
          layout === "grid" ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" : "flex flex-col gap-1",
          over && "rounded-xl outline-dashed outline-1 outline-accent",
        )}
      >
        {items.map((item) => {
          const on = selected.includes(item.id);
          const kind = item.kind === "file" ? fileKind(item.mime, item.name) : "folder";
          return (
            <li key={item.id}>
              <article
                className={cn(
                  "rounded-xl bg-card shadow-[var(--shadow-border)]",
                  on && "ring-2 ring-foreground/30",
                  layout === "grid" ? "relative flex min-h-32 flex-col overflow-visible p-3" : "flex items-center gap-2 px-3 py-1.5",
                )}
              >
                <button
                  type="button"
                  className={cn(
                    "min-w-0 text-left",
                    layout === "grid" ? "flex flex-1 flex-col items-start gap-2 pr-8" : "flex min-h-11 min-w-0 flex-1 items-center gap-3",
                  )}
                  onClick={(e) => {
                    onMenu(null);
                    if (e.detail === 2) {
                      if (item.kind === "folder") onOpen(item);
                      else onPreview(item);
                      return;
                    }
                    onPick(item, e);
                    if (item.kind === "folder" && !e.shiftKey && !e.metaKey && !e.ctrlKey && layout === "grid") onOpen(item);
                  }}
                >
                  <NodeGlyph node={item} mode={mode} layout={layout} />
                  <span className={cn("min-w-0", layout === "list" && "flex min-w-0 flex-1 items-center gap-3")}>
                    <span className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      {layout === "grid" ? (
                        <p className="text-xs text-faint">
                          {item.kind === "folder" ? (item.synced === false ? "Not syncing" : "Syncing") : `${kindLabel(kind)} · ${formatBytes(item.size)}${item.version > 1 ? ` · v${item.version}` : ""}`}
                        </p>
                      ) : null}
                    </span>
                    {layout === "list" ? (
                      <>
                        <span className="hidden w-44 shrink-0 truncate text-xs text-faint md:block">{formatWhen(item.updatedAt)}</span>
                        <span className="hidden w-32 shrink-0 truncate text-xs text-faint lg:block">{typeLabel(item.kind, item.mime, item.name)}</span>
                        <span className="hidden w-24 shrink-0 text-right text-xs text-faint md:block">{item.kind === "folder" ? "—" : formatBytes(item.size)}</span>
                      </>
                    ) : null}
                  </span>
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
                    onPick(item, e);
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
              view={view}
              anchor={anchor}
              onOpen={onOpen}
              onGet={onGet}
              onCopy={onCopy}
              onMove={onMove}
              onShare={onShare}
              onSync={onSync}
              onHistory={onHistory}
              onComments={onComments}
              onTrash={onTrash}
              onRename={onRename}
              onRestore={onRestore}
              onPurge={onPurge}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function ActionMenu({
  item,
  view,
  anchor,
  onOpen,
  onGet,
  onCopy,
  onMove,
  onShare,
  onSync,
  onHistory,
  onComments,
  onTrash,
  onRename,
  onRestore,
  onPurge,
}: {
  item: PotionNode;
  view: View;
  anchor: HTMLButtonElement;
  onOpen: (n: PotionNode) => void;
  onGet: (n: PotionNode) => void;
  onCopy: (n: PotionNode) => void;
  onMove: (n: PotionNode) => void;
  onShare: (n: PotionNode) => void;
  onSync: (n: PotionNode) => void;
  onHistory: (n: PotionNode) => void;
  onComments: (n: PotionNode) => void;
  onTrash: (n: PotionNode) => void;
  onRename: (n: PotionNode) => void;
  onRestore: (n: PotionNode) => void;
  onPurge: (n: PotionNode) => void;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const width = 192;
    const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
    const top = Math.min(r.bottom + 4, window.innerHeight - 420);
    setPos({ top, left });
  }, [anchor]);
  return (
    <div id="potion-action-menu" role="menu" style={{ top: pos.top, left: pos.left }} className="fixed z-50 w-48 rounded-xl bg-card p-1 shadow-[var(--shadow-border)]">
      {view === "trash" ? (
        <>
          <MenuRow label="Restore" onClick={() => onRestore(item)} />
          <MenuRow label="Delete forever" onClick={() => onPurge(item)} danger />
        </>
      ) : (
        <>
          {item.kind === "folder" ? <MenuRow label="Open" onClick={() => onOpen(item)} /> : <MenuRow label="Download" onClick={() => onGet(item)} />}
          <MenuRow label="Rename" onClick={() => onRename(item)} />
          <MenuRow label="Make a copy" onClick={() => onCopy(item)} />
          <MenuRow label="Move" onClick={() => onMove(item)} />
          <MenuRow label="Share" onClick={() => onShare(item)} />
          {item.kind === "file" ? <MenuRow label="Version history" onClick={() => onHistory(item)} /> : null}
          <MenuRow label="Comments" onClick={() => onComments(item)} />
          {item.kind === "folder" ? (
            <MenuRow label={item.synced === false ? "Sync folder" : "Don't sync"} onClick={() => onSync(item)} />
          ) : null}
          <MenuRow label="Move to trash" onClick={() => onTrash(item)} danger />
        </>
      )}
    </div>
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

function LivePill({ at }: { at: number }) {
  return (
    <span title={at ? `Updated ${formatWhen(at)}` : "This folder refreshes as it changes"} className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-3 text-xs text-muted">
      <span className="size-1.5 rounded-full bg-accent" />
      Live
    </span>
  );
}

function HistorySheet({
  name,
  versions,
  onRestore,
  onClose,
}: {
  name: string;
  versions: PotionVersion[];
  onRestore: (version: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-serif text-2xl italic">Version history</h3>
      <p className="text-sm text-muted">{name}. Restore writes a new current version. The last 20 saves stay on disk.</p>
      <ul className="max-h-64 space-y-1 overflow-auto">
        {versions.length === 0 ? <li className="px-3 py-2 text-sm text-muted">No other versions yet.</li> : null}
        {versions.map((v) => (
          <li key={v.version} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2">
            <span className="min-w-0">
              <p className="text-sm text-foreground">Version {v.version}{v.current ? " · current" : ""}</p>
              <p className="text-xs text-faint">
                {formatBytes(v.size)}
                {v.updatedAt ? ` · ${formatWhen(v.updatedAt)}` : ""}
              </p>
            </span>
            {v.current ? null : (
              <button type="button" className="h-11 rounded-full border border-border px-3 text-sm" onClick={() => onRestore(v.version)}>
                Restore
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <button type="button" className="h-11 rounded-full border border-border px-4 text-sm" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function CommentsSheet({
  name,
  comments,
  onPost,
  onClose,
}: {
  name: string;
  comments: PotionComment[];
  onPost: (body: string) => Promise<PotionComment>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(comments);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <h3 className="font-serif text-2xl italic">Comments</h3>
      <p className="text-sm text-muted">{name}</p>
      <ul className="max-h-56 space-y-2 overflow-auto">
        {rows.length === 0 ? <li className="text-sm text-muted">No comments yet.</li> : null}
        {rows.map((c) => (
          <li key={c.id} className="rounded-lg bg-elevated px-3 py-2">
            <p className="text-sm text-foreground">{c.body}</p>
            <p className="mt-1 text-xs text-faint">{formatWhen(c.createdAt)}</p>
          </li>
        ))}
      </ul>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const next = body.trim();
          if (!next) return;
          setBusy(true);
          void onPost(next)
            .then((row) => {
              setRows((cur) => [...cur, row]);
              setBody("");
            })
            .finally(() => setBusy(false));
        }}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 2000))}
          placeholder="Write a comment"
          rows={3}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="h-11 rounded-full border border-border px-4 text-sm" onClick={onClose}>
            Done
          </button>
          <button type="submit" disabled={busy || !body.trim()} className="h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60">
            Post
          </button>
        </div>
      </form>
    </div>
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
      <p className="text-sm text-muted">Pick a folder. The file is moved, not copied.</p>
      <ul className="max-h-64 space-y-1 overflow-auto">
        {targets.map((t) => (
          <li key={t.id ?? "root"}>
            <button type="button" onClick={() => onPick(t.id)} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-elevated">
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

function ShareSheet({ name, url, onCopy, onClose }: { name: string; url: string; onCopy: () => void; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <h3 className="font-serif text-2xl italic">Share {name}</h3>
      <p className="text-sm text-muted">Anyone with the link can view. No account needed on their side.</p>
      <div className="flex items-center gap-2 rounded-xl bg-elevated p-2">
        <code className="min-w-0 flex-1 truncate px-2 font-mono text-xs">{url}</code>
        <button type="button" onClick={onCopy} className="inline-flex h-11 items-center gap-1 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground">
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

function SyncPanel({ signedIn, mode, used }: { signedIn: boolean; mode: StoreMode; used: number }) {
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
  const btn = "inline-flex h-11 items-center gap-2 rounded-full border border-border px-4 text-sm disabled:opacity-40";
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 text-sm text-muted">
      <section className="space-y-4 rounded-2xl bg-card p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-foreground">Sync</h2>
        <p>Start walks folders marked Syncing. Pause holds the line. Stop clears it. Retry starts over.</p>
        <p className="font-mono text-xs text-faint tabular-nums">{formatBytes(used)} {signedIn ? "in your account" : "on this device"}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(btn, (running || paused) && "border-transparent bg-accent text-accent-foreground")}
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
          <button type="button" className={btn} disabled={running} onClick={() => void retrySync(mode)}>
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
            <span className="text-foreground">Folder</span> is Potion. Drop photos, videos, music, PDFs, zips, docs — any file.
          </li>
          <li>
            Sort like a file explorer: click <span className="text-foreground">Name</span>, <span className="text-foreground">Date modified</span>,{" "}
            <span className="text-foreground">Type</span>, or <span className="text-foreground">Size</span>. Click again to reverse. Folders stay on top.
          </li>
          <li>
            Search from the bar. Rename from the menu or F2. Trash is a real bin — restore or empty it.
          </li>
          <li>
            A folder marked <span className="text-foreground">Syncing</span> is included when you tap Start. Don’t sync skips it.
          </li>
          <li>
            Sign in, then Start. New files added while signed in start a catch-up on their own. Pictures count. Any size, including 1 GB.
          </li>
          <li>
            Version history keeps the last 20 saves. Comments sit on the file. Live watches this folder in other Potion windows.
          </li>
        </ol>
        <p className="flex items-start gap-2 pt-1">
          <Smartphone className="mt-0.5 size-4 shrink-0 text-faint" strokeWidth={1.75} />
          <span>The phone app is another window on Potion, not a second Sync.</span>
        </p>
      </section>
      <section className="space-y-2 rounded-2xl bg-card p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-foreground">You do not need an account</h2>
        <p>
          Skip sign-in and your files stay on <span className="text-foreground">this</span> browser.
        </p>
      </section>
      <section className="space-y-2 rounded-2xl bg-card p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-foreground">Sign in when you want</h2>
        <p>The same account on two devices shares the same files. Nothing copies until you sign in on the other device too.</p>
        <p className="text-foreground">{signedIn ? "You are signed in. These are your files." : "You are not signed in. Files stay on this device."}</p>
        {!signedIn ? (
          <Link to="/login" className="mt-2 inline-flex h-11 items-center rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground">
            Sign in (optional)
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
