import type { FlintApi } from "@flint/core/api";
import type { PairingUiEvent } from "@flint/core/pairing/controller";
import type { PairedDevice } from "@flint/core/pairing/devices";

/** Action strings sent by the native menu and by mailto links. */
export type MenuAction = string;

export interface FlintHost {
  platform: NodeJS.Platform;
  /** Opens http, https and mailto links in the system handler. Other schemes reject. */
  openExternal(url: string): Promise<void>;
  /** Fires when the user clicks a notification. Returns an unsubscribe function. */
  onOpenThread(cb: (threadId: number) => void): () => void;
  /** Fires on native menu clicks and mailto links ("compose" with the address as arg). */
  onMenu(cb: (action: MenuAction, arg?: string) => void): () => void;
  /** Scales the whole window (Settings, Appearance, Text size). Values outside 0.5 to 2 are ignored. */
  setZoomFactor(factor: number): void;
  /** Opens the bundled browser extension folder ("chromium" or "firefox") in Finder. Rejects when this build does not ship it. */
  revealExtension(family: "chromium" | "firefox"): Promise<void>;
  /** Set up iPhone: one session at a time. The code and the bundle never reach the window; only the QR image and the six digits do. */
  pairing: {
    start(): Promise<void>;
    approve(includePasswords: boolean): Promise<void>;
    cancel(): Promise<void>;
    devices(): Promise<PairedDevice[]>;
    forget(pairedAt: number): Promise<PairedDevice[]>;
    onEvent(cb: (event: PairingUiEvent) => void): () => void;
  };
  /** Sets what runs when the app quits, before the mail engine closes; quitting waits for it (with a cap). */
  onFlushDrafts(cb: () => Promise<unknown>): void;
  /** Absolute path of a dropped or picked file, or an empty string when it has none. */
  getPathForFile(file: File): string;
}

declare global {
  interface Window {
    flint: FlintApi;
    flintHost: FlintHost;
  }
}
