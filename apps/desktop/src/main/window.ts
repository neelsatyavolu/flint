import { fileURLToPath } from "node:url";
import { BrowserWindow, dialog, nativeTheme, screen } from "electron";
import { logger } from "@flint/core/log";
import { lockNavigation } from "./security";
import { planeBackground } from "./theme";
import { loadWindowState, MIN_HEIGHT, MIN_WIDTH, trackWindowState } from "./window-state";

const log = logger("window");

export type WindowOptions = { appUrl: string; appOrigin: string; stateFile: string };

export function createMainWindow(opts: WindowOptions): BrowserWindow {
  const state = loadWindowState(opts.stateFile, screen.getAllDisplays().map((d) => d.workArea));
  const win = new BrowserWindow({
    ...state,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: planeBackground(nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  if (state.maximized) win.maximize();
  trackWindowState(win, opts.stateFile);
  lockNavigation(win, opts.appOrigin);
  win.once("ready-to-show", () => win.show());

  const onTheme = (): void => {
    if (!win.isDestroyed()) win.setBackgroundColor(planeBackground(nativeTheme.shouldUseDarkColors));
  };
  nativeTheme.on("updated", onTheme);
  win.on("closed", () => nativeTheme.off("updated", onTheme));

  watchRenderer(win);
  void win.loadURL(opts.appUrl);
  return win;
}

/** A second crash within this window of the last automatic reload is left alone, so a crash on load can't loop. */
const CRASH_RELOAD_GUARD_MS = 60_000;

/** Reloads the window once when its renderer dies, and offers a reload when it stops responding. */
function watchRenderer(win: BrowserWindow): void {
  let lastReload = 0;
  let asking = false;
  win.webContents.on("render-process-gone", (_e, details) => {
    log.error("renderer gone", { reason: details.reason, exitCode: details.exitCode });
    if (details.reason === "clean-exit" || win.isDestroyed()) return;
    const now = Date.now();
    if (now - lastReload < CRASH_RELOAD_GUARD_MS) {
      log.error("renderer gone again soon after a reload; not reloading");
      return;
    }
    lastReload = now;
    win.webContents.reload();
  });
  win.on("unresponsive", () => {
    log.warn("window unresponsive");
    if (asking) return;
    asking = true;
    void dialog
      .showMessageBox(win, {
        type: "warning",
        message: "Flint isn't responding",
        detail: "You can wait for it to catch up or reload the window. Your mail and drafts are saved.",
        buttons: ["Wait", "Reload"],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response !== 1 || win.isDestroyed()) return;
        // A hung renderer can't run a reload itself: end it, then load the page fresh.
        lastReload = Date.now();
        win.webContents.forcefullyCrashRenderer();
        win.webContents.reload();
      })
      .finally(() => {
        asking = false;
      });
  });
}

export function focusWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export const isMac = process.platform === "darwin";