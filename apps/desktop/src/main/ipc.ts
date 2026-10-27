import { logger } from "@flint/core/log";
import type { FlintService } from "@flint/core/service/index";
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { CHANNELS } from "../preload/channels";
import { dispatchCall, extensionFolder, isSafeExternalUrl, isTrustedFrameUrl, type CallResult } from "./ipc-core";
import { shell } from "electron";
import { registerPairingIpc } from "./pairing-ipc";
import type { SecretStore } from "@flint/core/platform";

const log = logger("ipc");

export type IpcDeps = {
  getWindow: () => BrowserWindow | null;
  getService: () => FlintService | null;
  appOrigin: string;
  /** Set up iPhone (Settings > Devices). */
  pairing: { dataDir: string; secrets: SecretStore };
};

/** Registers the IPC handlers. Only the main window's top frame may call. */
export function registerIpc(deps: IpcDeps): void {
  const trusted = (e: IpcMainInvokeEvent): boolean => {
    const win = deps.getWindow();
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return false;
    return isTrustedFrameUrl(e.senderFrame?.url, deps.appOrigin);
  };

  ipcMain.handle(CHANNELS.call, async (e, method: unknown, args: unknown): Promise<CallResult> => {
    if (!trusted(e)) {
      log.warn("rejected call from untrusted sender");
      return { ok: false, error: { code: "permission", message: "Not allowed" } };
    }
    const service = deps.getService();
    if (!service) return { ok: false, error: { code: "internal", message: "Flint is still starting" } };
    return dispatchCall(service as unknown as Record<string, (...a: unknown[]) => unknown>, method, args);
  });

  registerPairingIpc({
    ipc: ipcMain,
    trusted,
    getService: deps.getService,
    ...deps.pairing,
    send: (event) => {
      const win = deps.getWindow();
      if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.pairingEvent, event);
    },
  });

  ipcMain.handle(CHANNELS.openExternal, async (e, url: unknown): Promise<void> => {
    if (!trusted(e)) throw new Error("Not allowed");
    if (!isSafeExternalUrl(url)) throw new Error("Only http, https and mailto links can be opened.");
    await shell.openExternal(url);
  });

  // The renderer names only the browser family; the folder comes from the service, never from the renderer.
  ipcMain.handle(CHANNELS.revealExtension, async (e, family: unknown): Promise<void> => {
    if (!trusted(e)) throw new Error("Not allowed");
    const status = await deps.getService()?.browserHelperStatus();
    const folder = extensionFolder(status?.extensionDir ?? null, family);
    if (!folder) throw new Error("This build of Flint doesn't include the browser extension.");
    shell.showItemInFolder(folder);
  });
}

/** Forwards service events to the renderer. Returns the unsubscribe function. */
export function forwardEvents(service: FlintService, getWindow: () => BrowserWindow | null): () => void {
  return service.subscribe((event) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.event, event);
  });
}
