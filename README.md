# Potion

A free Dropbox-style folder. Login optional. Sync only if you want it. No file-size cap — a 1 GB video is a regular file.

The app mark is a **flask with a P** on an ink tile. Windows uses a BMP 32-bit `.ico` (PNG-in-ICO showed as a white square). NSIS writes one Desktop shortcut named **Potion**. A second launch focuses the existing window.

**License:** MIT.

## Install (fresh GitHub download)

Unzip the repo (a second unzip named `potion-main (1)` is fine) so `deploy.bat` sits next to `package.json`. Then:

| Target | Double-click | What you get |
| --- | --- | --- |
| **Windows** | `deploy.bat` | **NSIS setup** (and **MSI** if WiX v3 is installed) under `src-tauri/target/release/bundle/`. Copy that installer to other PCs — they do not need Node or Rust. WebView2 is bundled. |
| **Android** | `apk.bat` (or `deploy/android/apk.bat`) | Real **Tauri APK** (same WebView app, not a PWA). Sideload `deploy/android/potion-v{ver}-arm64-release.apk`. |
| **Try on this PC** | `desktop-setup.bat` | Installs Rust if needed and opens the app window. |
| **Web** | `npm run dev` on a machine you control | Guest files stay on the device. Signed-in bytes live on that server’s disk, not on Vercel. |

**Windows, once:** [Node.js 22 LTS](https://nodejs.org) and [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**. The script can install Rust. First compile is slow.

**Android, once:** Node 22, the same C++ tools + Rust, [Microsoft OpenJDK 17](https://learn.microsoft.com/java/openjdk/download) or Temurin 17 (not Android Studio JBR / JDK 25), and Android Studio SDK + NDK. The packer adds the `aarch64-linux-android` Rust target and runs `npm install` if `node_modules` is missing.

Vite is installed with the packages — no global `vite` command. `.npmrc` has `legacy-peer-deps=true`.

After the Windows installer: Desktop has one **Potion** shortcut (flask + P). Pin that — do not keep leftover `potion` aliases from older builds.

## Use it

Open Potion. You do not need an account. Files live on this computer until you sign in and tap Start on Sync.

- **Folder** — list or grid, like a file explorer. Sort by name, date modified, type, or size. Search. Rename (F2). Copy, move, share, trash. Photos, videos, PDFs, zips, docs — any file, any size.
- **Version history** — each save keeps a version (last 20 on disk). Restore writes a new current version.
- **Comments** — notes on a file or folder, from the ••• menu.
- **Live** — this window refreshes when another Potion tab on the same device changes the folder. Signed-in accounts also poll for other devices.
- **Trash** — restore or delete forever.
- **Sync** — Start, Pause, Stop, Retry. Copies every file in folders marked Syncing (pictures included) to your account when you are signed in. The phone app is another window on Potion, not a second Sync.

Advice: sign in on each device you care about, then Start once. New files added while signed in start a catch-up on their own. A folder marked Don’t sync is skipped when Start runs. There is no size cap. A 1 GB file streams in 1 MB slices to disk (OPFS on this device, `.data/potion-blobs` on the server).

Do **not** host file bytes on Vercel. Vercel request bodies cap around 4.5 MB, so a gigabyte cannot land there. GitHub is the source. Run Potion yourself (`npm run dev` / `npm run build`) or use the desktop/Android apps.

## Self-host (web)

```
npm install
npm run dev
```

Production:

```
npm run build
```

Needs Node 22. Optional `DATABASE_URL` for signed-in accounts. File bytes for those accounts write under `.data/potion-blobs/{userId}/` on that machine. Without `DATABASE_URL`, files stay on the device (IndexedDB + OPFS).

## GitHub

https://github.com/eect13/potion

## Screenshots

![Folder](screenshots/v150-folder.png)

![Grid](screenshots/v150-grid.png)

![Version history](screenshots/v150-history.png)

![Comments](screenshots/v150-comments.png)

![Sync](screenshots/v150-sync.png)
