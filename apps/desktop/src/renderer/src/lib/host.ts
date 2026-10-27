import type { PairingUiEvent } from "@flint/core/pairing/controller";
import type { PairedDevice } from "@flint/core/pairing/devices";
import { readStored, writeStored } from "./storage";

/** Shape of window.flintHost (declared by preload). Kept local so renderer code needs no global augmentation. */
export type FlintHost = {
  platform: string;
  openExternal(url: string): Promise<void> | void;
  onOpenThread(cb: (threadId: number) => void): () => void;
  onMenu(cb: (action: string, arg?: string) => void): () => void;
  /** Opens the bundled browser extension folder in Finder. */
  revealExtension?(family: "chromium" | "firefox"): Promise<void>;
  /** Set up iPhone. Missing in the web build and in older preloads. */
  pairing?: {
    start(): Promise<void>;
    approve(includePasswords: boolean): Promise<void>;
    cancel(): Promise<void>;
    devices(): Promise<PairedDevice[]>;
    forget(pairedAt: number): Promise<PairedDevice[]>;
    onEvent(cb: (event: PairingUiEvent) => void): () => void;
  };
  /** Absolute path of a dropped or picked file (Electron removed File.path). */
  getPathForFile?(file: File): string;
  /** Scales the whole window. Missing in the web build and in older preloads. */
  setZoomFactor?(factor: number): void;
};

export function getHost(): FlintHost | undefined {
  return (window as unknown as { flintHost?: FlintHost }).flintHost;
}

export function openExternal(url: string): void {
  const host = getHost();
  if (host) void host.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function isMac(): boolean {
  const p = getHost()?.platform;
  return p ? p === "darwin" : /Mac/.test(navigator.platform);
}

export type TextSize = "small" | "default" | "large" | "larger";

/** Settings, Appearance, Text size. Stored per device; the window zoom scales every pane alike. */
export const TEXT_SIZES: { value: TextSize; label: string; factor: number }[] = [
  { value: "small", label: "Small", factor: 0.9 },
  { value: "default", label: "Default", factor: 1 },
  { value: "large", label: "Large", factor: 1.1 },
  { value: "larger", label: "Larger", factor: 1.25 },
];

const TEXT_SIZE_KEY = "flint.textSize";

export function readTextSize(): TextSize {
  const raw = readStored(TEXT_SIZE_KEY);
  return TEXT_SIZES.find((t) => t.value === raw)?.value ?? "default";
}

/** Applies a text size to the window and, with `persist`, remembers it on this device. */
export function applyTextSize(size: TextSize, persist = false): void {
  const hit = TEXT_SIZES.find((t) => t.value === size) ?? TEXT_SIZES[1]!;
  if (persist) writeStored(TEXT_SIZE_KEY, hit.value);
  getHost()?.setZoomFactor?.(hit.factor);
}
