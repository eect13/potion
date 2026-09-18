export type Theme = "light" | "dark";

const KEY = "potion-theme";

export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function writeTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f3f1ea" : "#0a0b0a");
}

export const THEME_BOOT =
  "document.documentElement.classList.add(localStorage.getItem('potion-theme')==='light'?'light':'dark')";
