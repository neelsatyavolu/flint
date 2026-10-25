import { fileURLToPath } from "node:url";
import { BrowserWindow, nativeTheme, screen } from "electron";
import { lockNavigation } from "./security";
import { planeBackground } from "./theme";
import { loadWindowState, MIN_HEIGHT, MIN_WIDTH, trackWindowState } from "./window-state";

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

  void win.loadURL(opts.appUrl);
  return win;
}

export function focusWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export const isMac = process.platform === "darwin";