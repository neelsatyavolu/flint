import { spawn } from "node:child_process";
import { HELPER_MAX_LINE_BYTES } from "@flint/core/autofill/contract";
import type { HelperProcess } from "./manager";

/**
 * Splits a byte stream into UTF-8 lines. A line longer than the protocol limit is dropped whole (the reader resyncs
 * at the next newline), so a runaway helper cannot grow memory.
 */
export function createLineReader(onLine: (line: string) => void, maxBytes = HELPER_MAX_LINE_BYTES): (chunk: Buffer) => void {
  let pending: Buffer[] = [];
  let size = 0;
  let skipping = false;
  return (chunk) => {
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf(0x0a, start);
      const end = nl === -1 ? chunk.length : nl;
      if (!skipping) {
        size += end - start;
        if (size > maxBytes) { skipping = true; pending = []; }
        else pending.push(chunk.subarray(start, end));
      }
      if (nl === -1) return;
      if (!skipping && size > 0) onLine(Buffer.concat(pending).toString("utf8"));
      pending = [];
      size = 0;
      skipping = false;
      start = nl + 1;
    }
  };
}

/** Spawns the FlintAutofill binary with piped stdio. Spawn failures surface as an exit, never as an uncaught error. */
export function spawnHelperProcess(path: string): HelperProcess {
  const child = spawn(path, [], { stdio: ["pipe", "pipe", "pipe"] });
  const lineListeners: Array<(line: string) => void> = [];
  const exitListeners: Array<(code: number | null, signal: string | null) => void> = [];
  let exited = false;
  const fireExit = (code: number | null, signal: string | null): void => {
    if (exited) return;
    exited = true;
    for (const cb of exitListeners) cb(code, signal);
  };
  child.stdout.on("data", createLineReader((line) => { for (const cb of lineListeners) cb(line); }));
  child.stderr.on("data", () => { /* diagnostics only; drained so the pipe never fills, never logged */ });
  child.stdin.on("error", () => { /* helper already gone; the exit event follows */ });
  child.on("error", () => fireExit(null, null));
  child.on("exit", (code, signal) => fireExit(code, signal));
  return {
    get pid() { return child.pid; },
    write: (line) => { if (!child.stdin.destroyed) child.stdin.write(line); },
    onLine: (cb) => { lineListeners.push(cb); },
    onExit: (cb) => { if (exited) queueMicrotask(() => cb(null, null)); else exitListeners.push(cb); },
    kill: (signal) => { child.kill(signal); },
  };
}
