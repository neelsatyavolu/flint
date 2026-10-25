import type { FlintApi, Settings } from "@flint/core";

import { readStored, writeStored } from "./storage";

export type ThemeSetting = Settings["appearance"]["theme"];
export type ResolvedTheme = "dark" | "light";

const QUERY = "(prefers-color-scheme: light)";
/** Last applied theme setting, read by index.html and main.tsx before first paint. */
export const THEME_CACHE_KEY = "flint.theme";
const NO_TRANSITION_CLASS = "no-theme-transition";

export function isThemeSetting(v: unknown): v is ThemeSetting {
  return v === "system" || v === "dark" || v === "light";
}

export function cachedThemeSetting(): ThemeSetting {
  const raw = readStored(THEME_CACHE_KEY);
  return isThemeSetting(raw) ? raw : "system";
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia(QUERY).matches ? "light" : "dark";
}

export function resolveTheme(setting: ThemeSetting): ResolvedTheme {
  return setting === "system" ? systemTheme() : setting;
}

/** Sets data-theme on <html>. 'system' resolves now; watchSystemTheme keeps it current. */
export function applyTheme(setting: ThemeSetting, root: HTMLElement = document.documentElement): ResolvedTheme {
  const resolved = resolveTheme(setting);
  if (root.getAttribute("data-theme") !== resolved) {
    // Rows and panes transition background/color; a theme switch must jump, not animate.
    root.classList.add(NO_TRANSITION_CLASS);
    root.setAttribute("data-theme", resolved);
  }
  if (root.classList.contains(NO_TRANSITION_CLASS)) releaseTransitions(root);
  root.dataset.themeSetting = setting;
  writeStored(THEME_CACHE_KEY, setting);
  return resolved;
}

function releaseTransitions(root: HTMLElement): void {
  const release = () => root.classList.remove(NO_TRANSITION_CLASS);
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(release));
  else release();
}

export function getResolvedTheme(root: HTMLElement = document.documentElement): ResolvedTheme {
  return root.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** Re-applies the theme when the OS appearance changes and the setting is 'system'. */
export function watchSystemTheme(getSetting: () => ThemeSetting): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia(QUERY);
  const onChange = () => {
    if (getSetting() === "system") applyTheme("system");
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Applies the stored theme at startup and follows settings events and OS changes. */
export function startThemeSync(api: Pick<FlintApi, "getSettings" | "subscribe">): () => void {
  let current: ThemeSetting = cachedThemeSetting();
  applyTheme(current);
  let disposed = false;
  let sawEvent = false; // an event is newer than the initial fetch
  api.getSettings().then(
    (s) => {
      if (disposed || sawEvent) return;
      current = s.appearance.theme;
      applyTheme(current);
    },
    () => undefined,
  );
  const unsub = api.subscribe((e) => {
    if (e.type === "settings") {
      sawEvent = true;
      current = e.settings.appearance.theme;
      applyTheme(current);
    }
  });
  const unwatch = watchSystemTheme(() => current);
  return () => {
    disposed = true;
    unsub();
    unwatch();
  };
}
