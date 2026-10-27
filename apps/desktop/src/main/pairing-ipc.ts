import { PairingController, type PairingUiEvent } from "@flint/core/pairing/controller";
import { fileDevicesStore } from "@flint/core/pairing/devices";
import type { SecretStore } from "@flint/core/platform";
import { hostname } from "node:os";
import { join } from "node:path";
import { CHANNELS } from "../preload/channels";
import { serviceBundleSource } from "./pairing-source";
import type { FlintService } from "@flint/core/service/index";

/** The bit of `ipcMain` used here, so tests need no Electron. */
export type IpcHandle = { handle(channel: string, fn: (e: unknown, ...args: unknown[]) => unknown): void };

export type PairingIpcDeps = {
  ipc: IpcHandle;
  trusted: (e: never) => boolean;
  getService: () => FlintService | null;
  secrets: SecretStore;
  dataDir: string;
  send: (event: PairingUiEvent) => void;
};

const DEVICES_FILE = "paired-devices.json";

/** Registers the Set up iPhone handlers. Only the main window's top frame may call; the controller is built on first use. */
export function registerPairingIpc(deps: PairingIpcDeps): { controller: () => PairingController | null } {
  let controller: PairingController | null = null;
  const get = (): PairingController => {
    const service = deps.getService();
    if (!service) throw new Error("Flint is still starting");
    controller ??= new PairingController({
      source: serviceBundleSource(service, deps.secrets, hostname),
      devices: fileDevicesStore(join(deps.dataDir, DEVICES_FILE)),
      send: deps.send,
    });
    return controller;
  };
  const guard = <T>(fn: (...args: unknown[]) => T) => (e: unknown, ...args: unknown[]): T => {
    if (!deps.trusted(e as never)) throw new Error("Not allowed");
    return fn(...args);
  };
  deps.ipc.handle(CHANNELS.pairingStart, guard(() => get().start()));
  deps.ipc.handle(CHANNELS.pairingApprove, guard((include) => get().approve(include === true)));
  deps.ipc.handle(CHANNELS.pairingCancel, guard(() => controller?.cancel()));
  deps.ipc.handle(CHANNELS.pairingDevices, guard(() => get().listDevices()));
  deps.ipc.handle(CHANNELS.pairingForget, guard((pairedAt) => {
    if (typeof pairedAt !== "number" || !Number.isFinite(pairedAt)) throw new Error("Invalid device");
    return get().forget(pairedAt);
  }));
  return { controller: () => controller };
}
