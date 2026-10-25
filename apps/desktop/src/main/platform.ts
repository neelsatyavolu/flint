import { join } from "node:path";
import { logger } from "@flint/core/log";
import type { Platform } from "@flint/core/platform";
import { app, Notification, safeStorage, shell } from "electron";
import { isSafeExternalUrl } from "./ipc-core";
import { createSecretStore } from "./secret-store";

const log = logger("platform");

export type PlatformHooks = {
  /** Called when the user clicks a notification. */
  onNotificationClick: (threadId: number | undefined) => void;
};

export function resolveDataDir(): string {
  return process.env.FLINT_DATA_DIR?.trim() || app.getPath("userData");
}

export function createPlatform(dataDir: string, hooks: PlatformHooks): Platform {
  // Notifications must stay referenced until clicked or closed, or they can be collected.
  const live = new Set<Notification>();
  return {
    dataDir,
    downloadsDir: app.getPath("downloads"),
    secrets: createSecretStore(join(dataDir, "secrets.bin"), safeStorage, { allowPlain: !app.isPackaged }),
    appVersion: app.getVersion(),
    async openExternal(url) {
      if (!isSafeExternalUrl(url)) throw new Error("Only http, https and mailto links can be opened.");
      await shell.openExternal(url);
    },
    async openPath(path) {
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
    },
    notify({ title, body, threadId }) {
      if (!Notification.isSupported()) {
        log.warn("notifications are not supported on this system");
        return;
      }
      const n = new Notification({ title, body });
      live.add(n);
      n.on("click", () => hooks.onNotificationClick(threadId));
      n.on("close", () => live.delete(n));
      n.show();
    },
  };
}
