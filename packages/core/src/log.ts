import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { appendFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

type Level = "debug" | "info" | "warn" | "error";

export type LogOptions = {
  /** Rotate when the file reaches this size. Default 5 MB. */
  maxBytes?: number;
  /** Files kept including the current one (flint.log, flint.log.1, ...). Default 3. */
  keep?: number;
  /** Delay before buffered lines are written. Default 250 ms. */
  flushMs?: number;
  /** Write debug lines. Default: only outside production. */
  debug?: boolean;
};

const MAX_BUFFER_BYTES = 64 * 1024;
const isProduction = process.env.NODE_ENV === "production";
const toStderr = !isProduction && !process.env.VITEST;

let logFile: string | null = null;
let opts: Required<LogOptions> = { maxBytes: 5 * 1024 * 1024, keep: 3, flushMs: 250, debug: !isProduction };
let buffer: string[] = [];
let buffered = 0;
let fileSize = 0;
let timer: NodeJS.Timeout | null = null;
let chain: Promise<void> = Promise.resolve();
let exitHook = false;

/** Call once at startup with the data dir; before that, logs only go to stderr in dev. */
export function initLog(dataDir: string, options: LogOptions = {}): void {
  const dir = join(dataDir, "logs");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  logFile = join(dir, "flint.log");
  opts = { maxBytes: 5 * 1024 * 1024, keep: 3, flushMs: 250, debug: !isProduction, ...options };
  try { fileSize = statSync(logFile).size; } catch { fileSize = 0; }
  if (!exitHook) {
    exitHook = true;
    process.on("exit", flushLogSync);
  }
}

/** flint.log.2 -> dropped, flint.log.1 -> .2, flint.log -> .1, using async fs. */
async function rotate(file: string): Promise<void> {
  const oldest = opts.keep - 1;
  if (oldest < 1) {
    await rm(file, { force: true });
    return;
  }
  await rm(`${file}.${oldest}`, { force: true });
  for (let i = oldest - 1; i >= 1; i--) await rename(`${file}.${i}`, `${file}.${i + 1}`).catch(() => undefined);
  await rename(file, `${file}.1`).catch(() => undefined);
}

function drain(): void {
  timer = null;
  if (!logFile || buffer.length === 0) return;
  const file = logFile;
  const text = buffer.join("");
  buffer = [];
  buffered = 0;
  const size = Buffer.byteLength(text);
  chain = chain.then(async () => {
    try {
      if (fileSize > 0 && fileSize + size > opts.maxBytes) {
        await rotate(file);
        fileSize = 0;
      }
      await appendFile(file, text, { mode: 0o600 });
      fileSize += size;
    } catch {
      // Disk full or unwritable: keep running.
    }
  });
}

/** Resolves when everything logged so far is on disk. */
export function flushLog(): Promise<void> {
  if (timer) clearTimeout(timer);
  drain();
  return chain;
}

/** Writes whatever is still buffered, synchronously. For process exit. */
function flushLogSync(): void {
  if (!logFile || buffer.length === 0) return;
  const text = buffer.join("");
  buffer = [];
  buffered = 0;
  try {
    if (fileSize > 0 && fileSize + Buffer.byteLength(text) > opts.maxBytes) {
      for (let i = opts.keep - 1; i >= 1; i--) {
        if (i === opts.keep - 1) rmSync(`${logFile}.${i}`, { force: true });
        else { try { renameSync(`${logFile}.${i}`, `${logFile}.${i + 1}`); } catch { /* missing */ } }
      }
      try { renameSync(logFile, `${logFile}.1`); } catch { /* missing */ }
    }
    appendFileSync(logFile, text, { mode: 0o600 });
  } catch {
    // Nothing more to do at exit.
  }
}

function write(level: Level, scope: string, message: string, extra?: Record<string, unknown>): void {
  if (level === "debug" && !opts.debug) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}${extra ? " " + JSON.stringify(extra) : ""}\n`;
  if (logFile) {
    buffer.push(line);
    buffered += line.length;
    if (buffered >= MAX_BUFFER_BYTES || level === "error") {
      if (timer) clearTimeout(timer);
      drain();
    } else if (!timer) {
      timer = setTimeout(drain, opts.flushMs);
      timer.unref();
    }
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
