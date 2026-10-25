import type { BrowserWindow, Session } from "electron";
import { app, shell } from "electron";
import { buildCsp } from "./csp";
import { isSafeExternalUrl, isSameOrigin } from "./ipc-core";
import type { RequestFilter } from "./request-filter";

const ALLOWED_PERMISSIONS = new Set(["notifications", "clipboard-sanitized-write"]);

/** One-time session hardening: CSP, request blocking, permissions. */
export function secureSession(ses: Session, opts: { appOrigin: string; dev: boolean; filter: RequestFilter }): void {
  const csp = buildCsp({ dev: opts.dev });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const isDocument = details.resourceType === "mainFrame" || details.resourceType === "subFrame";
    if (!isDocument || !details.url.startsWith(opts.appOrigin)) {
      callback({});
      return;
    }
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "content-security-policy") delete headers[key];
    }
    callback({ responseHeaders: { ...headers, "Content-Security-Policy": [csp] } });
  });

  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: opts.filter.shouldBlock(details.url) });
  });

  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

/** Keeps the window on the app and sends every outside link to the system browser. */
export function lockNavigation(win: BrowserWindow, appOrigin: string): void {
  const openOutside = (url: string): void => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  };
  const isInternal = (url: string): boolean => {
    if (url === "about:srcdoc" || url === "about:blank") return true;
    return isSameOrigin(url, appOrigin);
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  // Covers the main frame and sandboxed mail iframes.
  win.webContents.on("will-frame-navigate", (event) => {
    if (isInternal(event.url)) return;
    event.preventDefault();
    openOutside(event.url);
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isInternal(url)) return;
    event.preventDefault();
    openOutside(url);
  });
}

export function isDevBuild(): boolean {
  return !app.isPackaged;
}
