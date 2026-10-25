import { execFile } from "node:child_process";
import { extname } from "node:path";
import { logger } from "../log";

const log = logger("service.attachments");

/** File types that run code, or render active content, when the system opens them. Flint never opens these itself. */
const RISKY_EXTENSIONS: ReadonlySet<string> = new Set([
  ".command", ".terminal", ".app", ".pkg", ".mpkg", ".dmg", ".workflow", ".action", ".scpt", ".scptd", ".applescript", ".jar",
  ".sh", ".bash", ".zsh", ".csh", ".ksh", ".bat", ".cmd", ".com", ".exe", ".msi", ".scr", ".pif", ".ps1", ".psm1", ".vbs", ".vbe",
  ".js", ".jse", ".wsf", ".wsh", ".hta", ".lnk", ".reg", ".webloc", ".inetloc", ".fileloc", ".url", ".html", ".htm", ".xhtml", ".svg",
  ".py", ".pl", ".rb", ".php", ".dylib", ".so", ".dll", ".iso", ".img", ".jnlp", ".appimage", ".deb", ".rpm", ".apk", ".prefpane", ".saver",
]);

/** The risky extension of this filename (lowercase, with the dot), or null when it is safe to hand to the system. */
export function riskyExtension(filename: string): string | null {
  const ext = extname(filename.trim()).toLowerCase();
  return RISKY_EXTENSIONS.has(ext) ? ext : null;
}

/**
 * Marks a file as downloaded from the internet so macOS Gatekeeper checks it before running it. Electron's
 * shell.openPath and our own writes do not set the flag. Best effort and macOS only.
 */
export async function quarantine(path: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform !== "darwin") return;
  const value = `0081;${Math.floor(Date.now() / 1000).toString(16)};Flint;`;
  await new Promise<void>((resolve) => {
    execFile("/usr/bin/xattr", ["-w", "com.apple.quarantine", value, path], (error) => {
      if (error) log.warn("could not quarantine a file", { reason: error.message });
      resolve();
    });
  });
}
