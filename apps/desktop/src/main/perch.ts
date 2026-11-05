import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import { isSafeExternalUrl } from "./ipc-core";

/** Perch, the owner's browser. Links can open there from a link's right-click menu when it is installed. */
export const PERCH_BUNDLE_ID = "co.xanom.perch";

/** Perch.app in /Applications or ~/Applications, or null when it isn't installed. */
export function findPerchApp(exists: (path: string) => boolean = existsSync, home: string = homedir()): string | null {
  const candidates = ["/Applications/Perch.app", join(home, "Applications", "Perch.app")];
  return candidates.find((p) => exists(p)) ?? null;
}

function isWebLink(url: string): boolean {
  if (!isSafeExternalUrl(url)) return false;
  const protocol = new URL(url).protocol;
  return protocol === "http:" || protocol === "https:";
}

type LinkMenuOptions = {
  perch: boolean;
  open: (url: string) => void;
  openInPerch: (url: string) => void;
  copy: (text: string) => void;
};

/** The right-click menu for a link, or null when the link isn't one Flint opens. */
export function linkMenuTemplate(link: string, opts: LinkMenuOptions): MenuItemConstructorOptions[] | null {
  if (!isSafeExternalUrl(link)) return null;
  const perch: MenuItemConstructorOptions[] = opts.perch && isWebLink(link)
    ? [{ label: "Open in Perch", click: () => opts.openInPerch(link) }]
    : [];
  return [
    { label: "Open Link", click: () => opts.open(link) },
    ...perch,
    { type: "separator" },
    { label: "Copy Link", click: () => opts.copy(link) },
  ];
}

type Run = (cmd: string, args: string[], cb: (err: Error | null) => void) => void;

/** Opens a web link in Perch through macOS's open command; arguments go straight to it, no shell. */
export function openInPerch(url: string, run: Run = execFile as unknown as Run): Promise<void> {
  if (!isWebLink(url)) return Promise.reject(new Error("Perch opens web links only."));
  return new Promise((resolve, reject) => {
    run("/usr/bin/open", ["-b", PERCH_BUNDLE_ID, url], (err) => (err ? reject(err) : resolve()));
  });
}
