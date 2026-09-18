# Potion

A folder for your apps. Login optional. Sync only if you want it.

The app mark is a **flask with a P** on an ink tile. Windows uses a BMP 32-bit `.ico` (PNG-in-ICO showed as a white square). NSIS writes one Desktop shortcut named **Potion**. A second launch focuses the existing window.

**License:** MIT.

## Install (fresh GitHub download)

Unzip the repo (a second unzip named `potion-main (1)` is fine) so `deploy.bat` sits next to `package.json`. Then:

| Target | Double-click | What you get |
| --- | --- | --- |
| **Windows** | `deploy.bat` | **NSIS setup** (and **MSI** if WiX v3 is installed) under `src-tauri/target/release/bundle/`. Copy that installer to other PCs — they do not need Node or Rust. WebView2 is bundled. |
| **Android** | `apk.bat` (or `deploy/android/apk.bat`) | Real **Tauri APK** (same WebView app, not a PWA). Sideload `deploy/android/potion-v{ver}-arm64-release.apk`. |
| **Try on this PC** | `desktop-setup.bat` | Installs Rust if needed and opens the app window. |
| **Web** | [potion-eect13.vercel.app](https://potion-eect13.vercel.app) | Browser / PWA. Guest files stay on the device. |

**Windows, once:** [Node.js 22 LTS](https://nodejs.org) and [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**. The script can install Rust. First compile is slow.

**Android, once:** Node 22, the same C++ tools + Rust, [Microsoft OpenJDK 17](https://learn.microsoft.com/java/openjdk/download) or Temurin 17 (not Android Studio JBR / JDK 25), and Android Studio SDK + NDK. The packer adds the `aarch64-linux-android` Rust target and runs `npm install` if `node_modules` is missing.

Vite is installed with the packages — no global `vite` command. `.npmrc` has `legacy-peer-deps=true`.

After the Windows installer: Desktop has one **Potion** shortcut (flask + P). Pin that — do not keep leftover `potion` aliases from older builds.

## Use it

Open Potion. You do not need an account. Files live on this computer until you sign in and turn on sync.

- **Folder** — list or grid. Copy, move, delete, share, sync / unsync.
- **Apps** — type the names you want. Add and remove.
- **Sync** — Start, Pause, Stop, Retry. Only when you ask.

## Self-host (web)

```
npm install
npm run dev
```

Production:

```
npm run build
```

Needs Node 22. Optional `DATABASE_URL` for the signed-in locker. Without it, files stay on the device.

## GitHub

https://github.com/eect13/potion
