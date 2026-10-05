/**
 * Origins Better Auth accepts on credentialed POSTs (sign-up/sign-in, …).
 *
 * Desktop / Android page origin (read, not guessed):
 * - `src-tauri/tauri.conf.json`: no `useHttpsScheme` on `app.windows[]`
 *   (defaults false). Identifier is `app.potion.desktop` (bundle id only).
 * - Tauri v2 WindowConfig `useHttpsScheme` docs
 *   (https://v2.tauri.app/reference/config/, fetched 2026-10-05): when false,
 *   custom protocols use `http://<scheme>.localhost` on Windows and Android.
 * - App frontend scheme is `tauri` → page origin `http://tauri.localhost`.
 * - wry #1709 confirms Android currently serves under `http://tauri.localhost`.
 * Windows and Android therefore share one Origin; there is no second distinct
 * Android page origin in this project's config or the Tauri docs above.
 */
export const LOCAL_DEV_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];

/** Installed-app page origin (Windows + Android). */
export const DESKTOP_APP_ORIGINS: string[] = ["http://tauri.localhost"];

export function buildTrustedOrigins(opts: {
  explicitBaseURL?: string;
  previewAllowedHosts: readonly string[];
}): string[] {
  const desktop = DESKTOP_APP_ORIGINS;
  if (opts.explicitBaseURL) {
    return [opts.explicitBaseURL, ...LOCAL_DEV_ORIGINS, ...desktop];
  }
  const hosts = [...opts.previewAllowedHosts];
  return [
    ...hosts,
    ...hosts.flatMap((host) => [`https://${host}`, `http://${host}`]),
    ...LOCAL_DEV_ORIGINS,
    ...desktop,
  ];
}
