import { FLINT_METHODS, type FlintApi } from "@flint/core/api";
import type { FlintEvent } from "@flint/core/types";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
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

const flint = {
  ...methods,
  subscribe: (listener: (event: FlintEvent) => void) => listen<[FlintEvent]>(CHANNELS.event, listener),
} as unknown as FlintApi;

const flintHost: FlintHost = {
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke(CHANNELS.openExternal, url) as Promise<void>,
  onOpenThread: (cb) => listen<[number]>(CHANNELS.openThread, cb),
  onMenu: (cb) => listen<[string, string | undefined]>(CHANNELS.menu, cb),
};

contextBridge.exposeInMainWorld("flint", flint);
contextBridge.exposeInMainWorld("flintHost", flintHost);
