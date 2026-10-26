import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Quotes a string for /bin/sh. */
export const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The native messaging host wrapper: browsers launch this script, which runs the bundled CLI's `native-host` command.
 * Same shape as the `flint` command wrapper (service/agents.ts), but with `native-host` before the browser's own arguments
 * (Chrome passes the extension origin, Firefox the manifest path and extension id).
 */
export function nativeHostWrapperScript(executable: string, cliPath: string, electron: boolean): string {
  const prefix = electron ? "ELECTRON_RUN_AS_NODE=1 " : "";
  return `#!/bin/sh\n# Installed by Flint for the verification code browser extension.\n${prefix}exec ${shellQuote(executable)} ${shellQuote(cliPath)} native-host "$@"\n`;
}

/** Writes a file atomically (temp file then rename), refusing to replace a symbolic link. */
export function writeFileAtomic(path: string, body: string, mode: number): void {
  mkdirSync(dirname(path), { recursive: true });
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`${path} is a symbolic link; refusing to overwrite it`);
  }
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, body, { mode, flag: "wx" });
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw error;
  }
}

export type ManifestRead = { exists: false } | { exists: true; value: unknown };

/** Reads a JSON file; `value` is undefined when it is not valid JSON (treated as foreign by callers). */
export function readJson(path: string): ManifestRead {
  if (!existsSync(path)) return { exists: false };
  try {
    return { exists: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { exists: true, value: undefined };
  }
}
