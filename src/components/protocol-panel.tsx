import { NAME_CANDIDATES } from "@/lib/names";

export function ProtocolPanel() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 pb-16">
      <header className="space-y-2">
        <p className="font-mono text-xs tracking-[0.16em] text-muted uppercase">Protocol</p>
        <h2 className="font-serif text-3xl font-normal italic text-foreground">WebDAV, and Nextcloud</h2>
        <p className="max-w-prose text-muted">
          Windows folders and most “cloud drives” are the same idea: a remote disk over HTTP. The
          spec is WebDAV (RFC 4918). Nextcloud is a full product built on top of it.
        </p>
      </header>

      <section className="space-y-3">
        <h3 className="text-sm font-medium tracking-wide text-foreground">What WebDAV adds to HTTP</h3>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Method</th>
                <th className="px-4 py-2.5 font-medium">Does</th>
              </tr>
            </thead>
            <tbody className="text-foreground">
              {[
                ["OPTIONS", "Advertise DAV: 1, 2 and MS-Author-Via — Windows looks for this"],
                ["PROPFIND", "List a folder. Depth 0 = self, 1 = children. 207 Multi-Status XML"],
                ["GET / PUT / DELETE", "Read, write, remove a file"],
                ["MKCOL", "Make a folder"],
                ["COPY / MOVE", "Destination header. Overwrite: F returns 412"],
                ["LOCK / UNLOCK", "Class 2. Word and Excel on a mapped drive need this"],
                ["PROPPATCH", "Set properties (Windows timestamps)"],
              ].map(([m, d]) => (
                <tr key={m} className="border-t border-border/70">
                  <td className="px-4 py-2.5 font-mono text-xs text-accent">{m}</td>
                  <td className="px-4 py-2.5 text-muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">
          Clients also need a stable <span className="font-mono text-foreground">getetag</span> so they
          can skip files that did not change. Potion’s self-host returns etags, quota bytes, and
          exclusive write locks.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium tracking-wide text-foreground">Where you mount it</h3>
        <ul className="space-y-2 rounded-xl border border-border bg-card p-4 font-mono text-xs text-accent">
          <li>/dav/</li>
          <li>/remote.php/dav/files/you/</li>
          <li>/remote.php/webdav/</li>
        </ul>
        <p className="text-sm text-muted">
          The last two are Nextcloud-shaped on purpose. rclone, Cyberduck, Finder, and Windows Map
          Network Drive recipes copy across. The official Nextcloud <em>desktop app</em> will not —
          it speaks extra OCS and chunked-upload APIs Potion does not pretend to be.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium tracking-wide text-foreground">Potion vs Nextcloud</h3>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Need</th>
                <th className="px-4 py-2.5 font-medium">Potion</th>
                <th className="px-4 py-2.5 font-medium">Nextcloud</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Files, share links, trash, versions", "Yes", "Yes"],
                ["Official phone + desktop sync apps", "No (WebDAV / agent)", "Yes"],
                ["Calendar, contacts, Talk, office docs", "No", "Yes"],
                ["RAM on a small box", "Tens of MB", "Often 2–4 GB"],
                ["API for Atrium and the studio apps", "First-class /api/v1", "Generic WebDAV + OCS"],
              ].map((row) => (
                <tr key={row[0]} className="border-t border-border/70">
                  {row.map((c) => (
                    <td key={c} className="px-4 py-2.5 text-muted first:text-foreground">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">
          If you want a personal Google Workspace this weekend, install Nextcloud. If you want a
          small branded drive the studio apps write into, keep Potion. They can sit on the same
          machine.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium tracking-wide text-foreground">Other names</h3>
        <p className="text-sm text-muted">Potion is the one on the tin. These were close:</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {NAME_CANDIDATES.map((n) => (
            <li
              key={n.name}
              className={`rounded-xl border p-4 ${
                "chosen" in n && n.chosen
                  ? "border-accent/40 bg-elevated"
                  : "border-border bg-card"
              }`}
            >
              <p className="font-serif text-lg italic">
                {n.name}
                {"chosen" in n && n.chosen ? (
                  <span className="ml-2 font-sans text-xs tracking-widest text-muted uppercase">
                    {" "}
                    current
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-sm text-muted">{n.line}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
