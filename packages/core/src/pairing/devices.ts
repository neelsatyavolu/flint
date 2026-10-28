// The list on Settings > Devices. Only a name and a date are kept; no key or session survives pairing.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type PairedDevice = { deviceName: string; pairedAt: number };

export interface PairedDevicesStore {
  list(): PairedDevice[];
  add(device: PairedDevice): void;
  remove(pairedAt: number): void;
}

const MAX_DEVICES = 50;

function isDevice(v: unknown): v is PairedDevice {
  const d = v as PairedDevice;
  return typeof d?.deviceName === "string" && typeof d.pairedAt === "number" && Number.isFinite(d.pairedAt);
}

/** A small JSON file. Unreadable or malformed content reads as an empty list. */
export function fileDevicesStore(path: string): PairedDevicesStore {
  const read = (): PairedDevice[] => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      return Array.isArray(parsed) ? parsed.filter(isDevice).map((d) => ({ deviceName: d.deviceName, pairedAt: d.pairedAt })) : [];
    } catch {
      return [];
    }
  };
  const write = (list: PairedDevice[]): void => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(list));
    renameSync(tmp, path);
  };
  return {
    list: () => read().sort((a, b) => b.pairedAt - a.pairedAt),
    add: (device) => write([{ deviceName: device.deviceName, pairedAt: device.pairedAt }, ...read()].slice(0, MAX_DEVICES)),
    remove: (pairedAt) => write(read().filter((d) => d.pairedAt !== pairedAt)),
  };
}

export function memoryDevicesStore(): PairedDevicesStore {
  let list: PairedDevice[] = [];
  return {
    list: () => [...list].sort((a, b) => b.pairedAt - a.pairedAt),
    add: (d) => { list = [{ ...d }, ...list]; },
    remove: (pairedAt) => { list = list.filter((d) => d.pairedAt !== pairedAt); },
  };
}
