import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFlintService } from "@flint/core";
import { refreshSkill } from "@flint/core/agent/skill";
import { initLog, logger } from "@flint/core/log";
import type { FlintService } from "@flint/core/service/index";
import type { Settings } from "@flint/core/types";
import type { BrowserWindow } from "electron";
import { app, dialog, nativeTheme, Notification, session } from "electron";
import electronUpdater from "electron-updater";
import { CHANNELS } from "../preload/channels";
import { APP_ORIGIN, APP_URL, registerAppScheme, serveRenderer } from "./app-protocol";
import { serveAttachments } from "./attachment-protocol";
import { badgeCount, createBadgeUpdater } from "./badge";
import { forwardEvents, registerIpc } from "./ipc";
import { installMenu } from "./menu";
import { parseMailto } from "./mailto";
import { createPlatform, resolveDataDir } from "./platform";
import { createRequestFilter, receiptsHostFromEndpoint } from "./request-filter";
import { secureSession } from "./security";
import { applyDefaultReceiptsEndpoint } from "./receipts-default";
import { bootstrapService } from "./service";
import { createUpdateController, type UpdateController, type UpdateMode } from "./updater";
import { createMainWindow, focusWindow, isMac } from "./window";

app.setName("Flint");
app.setPath("userData", process.env.FLINT_DATA_DIR?.trim() || join(app.getPath("appData"), "Flint"));
registerAppScheme();

const isDev = !app.isPackaged;
// Packaged builds never honor environment overrides for the renderer URL or the mock service.
const devUrl = isDev ? process.env.ELECTRON_RENDERER_URL : undefined;
const appUrl = devUrl ?? APP_URL;
const appOrigin = devUrl ? new URL(devUrl).origin : APP_ORIGIN;

let mainWindow: BrowserWindow | null = null;

declare const __FLINT_GOOGLE_CLIENT__: { clientId: string; clientSecret: string };
/** Set at build time (electron.vite.config.ts); empty in builds made without it. */
const BUILT_IN_GOOGLE = __FLINT_GOOGLE_CLIENT__;

/** The flint CLI script: shipped in Resources/cli when packaged, apps/cli/dist in development. */
function bundledCliPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "cli", "flint.js")
    : fileURLToPath(new URL("../../../cli/dist/flint.js", import.meta.url));
}
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
    onNotificationAction: (action, threadId) => {
      const run = action === "archive" ? service?.archive([threadId]) : service?.markRead([threadId], true);
      run?.catch((err: unknown) => log.warn("notification action failed", { action, message: String(err) }));
    },
  });

  const filter = createRequestFilter();
  secureSession(session.defaultSession, { appOrigin, dev: isDev, filter });
  if (!devUrl) serveRenderer(fileURLToPath(new URL("../renderer", import.meta.url)));

  serveAttachments(() => service, dataDir);
  registerIpc({ getWindow: () => mainWindow, getService: () => service, appOrigin });
  // Packaged builds update themselves from GitHub Releases (app-update.yml is written by electron-builder).
  // settings.updates.mode is applied below once the service has loaded the settings.
  let updateMode: UpdateMode = "ask";
  const updates: UpdateController | null = app.isPackaged
    ? createUpdateController({
        updater: electronUpdater.autoUpdater,
        currentVersion: app.getVersion(),
        getMode: () => updateMode,
        announce: (version) => {
          if (!Notification.isSupported()) return;
          new Notification({ title: `Flint ${version} is ready`, body: "It installs the next time you quit Flint.", silent: true }).show();
        },
        // Stop the service first so the before-quit handler doesn't hold up the installer's quit and relaunch.
        beforeInstall: async () => {
          quitting = true;
          await service?.stop().catch((err: unknown) => logger("main").error("service stop failed", { message: String(err) }));
        },
        ask: async (box) => {
          const opts = { type: "info" as const, ...box, defaultId: 0, cancelId: box.buttons.length - 1 };
          const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
          return (await (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))).response;
        },
      })
    : null;
  installMenu({ isMac, isDev, send: sendMenu, ...(updates ? { checkForUpdates: () => updates.check(true) } : {}) });

  const result = await bootstrapService({
    platform,
    forceMock: isDev && process.env.FLINT_MOCK === "1",
    create: createFlintService,
    options: { cliPath: bundledCliPath(), ...(BUILT_IN_GOOGLE.clientId ? { googleClient: BUILT_IN_GOOGLE } : {}) },
  });
  if (!result.ok) {
    dialog.showErrorBox("Flint can't start", `The mail engine failed to load.\n\n${result.message}`);
    quitting = true;
    app.exit(1);
    return;
  }
  service = result.service;
  if (result.mock) log.warn("running with the mock service");
  else {
    await applyDefaultReceiptsEndpoint(service, dataDir);
    // Keep an installed flint skill in step with this version's command.
    try {
      const changed = refreshSkill(homedir(), app.getVersion());
      if (changed) log.info("refreshed the flint agent skill", { changed });
    } catch (err) {
      log.warn("could not refresh the flint agent skill", { message: String(err) });
    }
  }

  let badgeMode: Settings["notifications"]["badge"] = (await service.getSettings()).notifications.badge;
  const badge = createBadgeUpdater({
    getUnread: async () => badgeCount(badgeMode, service!),
    setBadge: (n) => app.setBadgeCount(n),
  });
  const applySettings = (s: { receipts: { endpoint: string }; inbox: { blockTrackers: boolean }; appearance: { theme: "system" | "dark" | "light" }; updates: { mode: UpdateMode } }): void => {
    updateMode = s.updates.mode;
    filter.update({ receiptsHost: receiptsHostFromEndpoint(s.receipts.endpoint), blockTrackers: s.inbox.blockTrackers });
    nativeTheme.themeSource = s.appearance.theme;
  };
  applySettings(await service.getSettings());

  service.subscribe((e) => {
    if (e.type === "settings") {
      applySettings(e.settings);
      if (e.settings.notifications.badge !== badgeMode) {
        badgeMode = e.settings.notifications.badge;
        badge.request();
      }
    }
    if (e.type === "mail_changed" || e.type === "sync") badge.request();
  });
  forwardEvents(service, () => mainWindow);
  badge.request();

  openWindow(dataDir);
  updates?.start();
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
