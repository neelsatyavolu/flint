import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFlintService } from "@flint/core";
import { initLog, logger } from "@flint/core/log";
import type { FlintService } from "@flint/core/service/index";
import type { BrowserWindow } from "electron";
import { app, dialog, nativeTheme, session } from "electron";
import { CHANNELS } from "../preload/channels";
import { APP_ORIGIN, APP_URL, registerAppScheme, serveRenderer } from "./app-protocol";
import { serveAttachments } from "./attachment-protocol";
import { createBadgeUpdater } from "./badge";
import { forwardEvents, registerIpc } from "./ipc";
import { installMenu } from "./menu";
import { parseMailto } from "./mailto";
import { createPlatform, resolveDataDir } from "./platform";
import { createRequestFilter, receiptsHostFromEndpoint } from "./request-filter";
import { secureSession } from "./security";
import { bootstrapService } from "./service";
import { createMainWindow, focusWindow, isMac } from "./window";

app.setName("Flint");
app.setPath("userData", process.env.FLINT_DATA_DIR?.trim() || join(app.getPath("appData"), "Flint"));
registerAppScheme();

const devUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = !app.isPackaged;
const appUrl = devUrl ?? APP_URL;
const appOrigin = devUrl ? new URL(devUrl).origin : APP_ORIGIN;

let mainWindow: BrowserWindow | null = null;
let service: FlintService | null = null;
let rendererReady = false;
let quitting = false;
const pendingMenu: { action: string; arg?: string }[] = [];

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

function sendMenu(action: string, arg?: string): void {
  if (!rendererReady) {
    pendingMenu.push({ action, arg });
    return;
  }
  sendToRenderer(CHANNELS.menu, action, arg);
}

function composeTo(url: string): void {
  const address = parseMailto(url);
  if (address) {
    focusWindow(mainWindow);
    sendMenu("compose", address);
  }
}

function openWindow(dataDir: string): void {
  rendererReady = false;
  mainWindow = createMainWindow({ appUrl, appOrigin, stateFile: join(dataDir, "window.json") });
  mainWindow.webContents.on("did-finish-load", () => {
    rendererReady = true;
    for (const m of pendingMenu.splice(0)) sendToRenderer(CHANNELS.menu, m.action, m.arg);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererReady = false;
  });
}

async function main(): Promise<void> {
  const dataDir = resolveDataDir();
  initLog(dataDir);
  const log = logger("main");

  const platform = createPlatform(dataDir, {
    onNotificationClick: (threadId) => {
      focusWindow(mainWindow);
      if (threadId !== undefined) sendToRenderer(CHANNELS.openThread, threadId);
    },
  });

  const filter = createRequestFilter();
  secureSession(session.defaultSession, { appOrigin, dev: isDev, filter });
  if (!devUrl) serveRenderer(fileURLToPath(new URL("../renderer", import.meta.url)));

  serveAttachments(() => service, dataDir);
  registerIpc({ getWindow: () => mainWindow, getService: () => service, appOrigin });
  installMenu({ isMac, isDev, send: sendMenu });

  const result = await bootstrapService({
    platform,
    forceMock: process.env.FLINT_MOCK === "1",
    create: createFlintService,
  });
  if (!result.ok) {
    dialog.showErrorBox("Flint can't start", `The mail engine failed to load.\n\n${result.message}`);
    quitting = true;
    app.exit(1);
    return;
  }
  service = result.service;
  if (result.mock) log.warn("running with the mock service");

  const badge = createBadgeUpdater({
    getUnread: async () => (await service!.getSidebar()).counts.inbox,
    setBadge: (n) => app.setBadgeCount(n),
  });
  const applySettings = (s: { receipts: { endpoint: string }; inbox: { blockTrackers: boolean }; appearance: { theme: "system" | "dark" | "light" } }): void => {
    filter.update({ receiptsHost: receiptsHostFromEndpoint(s.receipts.endpoint), blockTrackers: s.inbox.blockTrackers });
    nativeTheme.themeSource = s.appearance.theme;
  };
  applySettings(await service.getSettings());

  service.subscribe((e) => {
    if (e.type === "settings") applySettings(e.settings);
    if (e.type === "mail_changed" || e.type === "sync") badge.request();
  });
  forwardEvents(service, () => mainWindow);
  badge.request();

  openWindow(dataDir);
  app.on("activate", () => {
    if (!mainWindow) openWindow(dataDir);
    else focusWindow(mainWindow);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    focusWindow(mainWindow);
    const mailto = argv.find((a) => a.toLowerCase().startsWith("mailto:"));
    if (mailto) composeTo(mailto);
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    composeTo(url);
  });
  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });
  app.on("before-quit", (event) => {
    if (quitting || !service) return;
    event.preventDefault();
    quitting = true;
    service
      .stop()
      .catch((err: unknown) => logger("main").error("service stop failed", { message: String(err) }))
      .finally(() => app.quit());
  });
  void app.whenReady().then(main).catch((err: unknown) => {
    dialog.showErrorBox("Flint can't start", err instanceof Error ? err.message : String(err));
    app.exit(1);
  });
}
