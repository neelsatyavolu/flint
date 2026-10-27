import { FLINT_METHODS, type FlintApi } from "@flint/core/api";
import type { PairingUiEvent } from "@flint/core/pairing/controller";
import type { PairedDevice } from "@flint/core/pairing/devices";
import type { FlintEvent } from "@flint/core/types";
import { contextBridge, ipcRenderer, webFrame, webUtils, type IpcRendererEvent } from "electron";
import { CHANNELS } from "./channels";
import type { FlintHost } from "./types";

type CallResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };

async function call(method: string, args: unknown[]): Promise<unknown> {
  const result = (await ipcRenderer.invoke(CHANNELS.call, method, args)) as CallResult;
  if (result.ok) return result.value;
  // contextBridge keeps only message and stack of an Error, so the code would be lost.
  // A plain object survives the bridge intact; the renderer wraps it in a FlintError.
  throw { name: "FlintError", code: result.error.code, message: result.error.message };
}

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A));
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const methods = Object.fromEntries(
  FLINT_METHODS.map((m) => [m, (...args: unknown[]) => call(m, args)]),
);

// Every component subscribes; one ipcRenderer listener fans out to all of them.
const subscribers = new Set<(event: FlintEvent) => void>();
let attached = false;
function subscribe(listener: (event: FlintEvent) => void): () => void {
  subscribers.add(listener);
  if (!attached) {
    attached = true;
    ipcRenderer.on(CHANNELS.event, (_e, event: FlintEvent) => {
      // One throwing handler must not starve the others.
      for (const s of [...subscribers]) {
        try {
          s(event);
        } catch (err) {
          console.error("Flint event handler failed", err);
        }
      }
    });
  }
  return () => {
    subscribers.delete(listener);
  };
}

const flint = { ...methods, subscribe } as unknown as FlintApi;

// On quit, main asks for unsaved drafts first and closes the database once answered. With nothing registered (no
// composer opened yet) the answer goes straight back, so quitting never waits on a missing handler.
let flushDrafts: (() => Promise<unknown>) | null = null;
ipcRenderer.on(CHANNELS.flushDrafts, () => {
  void Promise.resolve()
    .then(() => flushDrafts?.())
    .catch(() => undefined)
    .finally(() => ipcRenderer.send(CHANNELS.draftsFlushed));
});

const flintHost: FlintHost = {
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke(CHANNELS.openExternal, url) as Promise<void>,
  revealExtension: (family) => ipcRenderer.invoke(CHANNELS.revealExtension, family) as Promise<void>,
  onOpenThread: (cb) => listen<[number]>(CHANNELS.openThread, cb),
  onMenu: (cb) => listen<[string, string | undefined]>(CHANNELS.menu, cb),
  setZoomFactor: (factor) => {
    if (Number.isFinite(factor) && factor >= 0.5 && factor <= 2) webFrame.setZoomFactor(factor);
  },
  pairing: {
    start: () => ipcRenderer.invoke(CHANNELS.pairingStart) as Promise<void>,
    approve: (includePasswords) => ipcRenderer.invoke(CHANNELS.pairingApprove, includePasswords === true) as Promise<void>,
    cancel: () => ipcRenderer.invoke(CHANNELS.pairingCancel) as Promise<void>,
    devices: () => ipcRenderer.invoke(CHANNELS.pairingDevices) as Promise<PairedDevice[]>,
    forget: (pairedAt) => ipcRenderer.invoke(CHANNELS.pairingForget, pairedAt) as Promise<PairedDevice[]>,
    onEvent: (cb) => listen<[PairingUiEvent]>(CHANNELS.pairingEvent, cb),
  },
  onFlushDrafts: (cb) => {
    flushDrafts = cb;
  },
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
};

contextBridge.exposeInMainWorld("flint", flint);
contextBridge.exposeInMainWorld("flintHost", flintHost);
