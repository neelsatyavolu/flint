import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type Level = "debug" | "info" | "warn" | "error";
let logFile: string | null = null;
const toStderr = process.env.NODE_ENV !== "production" && !process.env.VITEST;

/** Call once at startup with the data dir; before that, logs only go to stderr in dev. */
export function initLog(dataDir: string): void {
  const dir = join(dataDir, "logs");
  mkdirSync(dir, { recursive: true });
  logFile = join(dir, "flint.log");
}

function write(level: Level, scope: string, message: string, extra?: Record<string, unknown>): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}${extra ? " " + JSON.stringify(extra) : ""}\n`;
  if (logFile) {
    try { appendFileSync(logFile, line); } catch { /* disk full or unwritable: keep running */ }
  }
  if (toStderr) process.stderr.write(line);
}

/** Scoped logger. Never pass message bodies, tokens or passwords. */
export function logger(scope: string) {
  return {
    debug: (m: string, e?: Record<string, unknown>) => write("debug", scope, m, e),
    info: (m: string, e?: Record<string, unknown>) => write("info", scope, m, e),
    warn: (m: string, e?: Record<string, unknown>) => write("warn", scope, m, e),
    error: (m: string, e?: Record<string, unknown>) => write("error", scope, m, e),
  };
}
