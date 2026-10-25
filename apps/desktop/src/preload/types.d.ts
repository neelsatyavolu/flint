import type { FlintApi } from "@flint/core/api";

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
}

declare global {
  interface Window {
    flint: FlintApi;
    flintHost: FlintHost;
  }
}
