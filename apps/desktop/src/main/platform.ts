import { join } from "node:path";
import { CODE_CLIPBOARD_CLEAR_MS } from "@flint/core/codes/contract";
import { logger } from "@flint/core/log";
import type { Platform } from "@flint/core/platform";
import { app, clipboard, dialog, Notification, safeStorage, shell } from "electron";
import { createClipboardCopier } from "./clipboard-copy";
import { isSafeExternalUrl } from "./ipc-core";
import { createNotifier, type NotifierHooks } from "./notify-actions";
import { createSecretStore } from "./secret-store";

const log = logger("platform");

export type PlatformHooks = {
  /** Called when the user clicks a notification. */
  onNotificationClick: (threadId: number | undefined) => void;
  /** Called when the user presses Archive, Move to Trash or Mark as read on a notification (macOS). */
  onNotificationAction: NotifierHooks["onAction"];
};

export function resolveDataDir(): string {
  return process.env.FLINT_DATA_DIR?.trim() || app.getPath("userData");
}

function warnKeychainUnavailable(): void {
  void dialog.showMessageBox({
    type: "error",
    title: "Flint",
    message: "Flint can't save your passwords",
    detail: "Your system keychain isn't available, so Flint is keeping account passwords in memory for this session only and you will need to sign in again next time. Unlock or set up your keychain, then restart Flint.",
    buttons: ["OK"],
  });
}

export function createPlatform(dataDir: string, hooks: PlatformHooks): Platform {
  const copyText = createClipboardCopier({ clipboard });
  const notify = createNotifier({
    isSupported: () => Notification.isSupported(),
    create: (options) => new Notification(options),
    isMac: process.platform === "darwin",
    hooks: { onClick: hooks.onNotificationClick, onAction: hooks.onNotificationAction, onCopy: (text) => copyText(text, CODE_CLIPBOARD_CLEAR_MS) },
    warn: (message) => log.warn(message),
  });
  return {
    dataDir,
    downloadsDir: app.getPath("downloads"),
    secrets: createSecretStore(join(dataDir, "secrets.bin"), safeStorage, {
      allowPlain: !app.isPackaged,
      memoryOnly: app.isPackaged,
      onMemoryOnly: warnKeychainUnavailable,
    }),
    appVersion: app.getVersion(),
    async openExternal(url) {
      if (!isSafeExternalUrl(url)) throw new Error("Only http, https and mailto links can be opened.");
      await shell.openExternal(url);
    },
    async openPath(path) {
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
    },
    notify,
    copyText,
  };
}
