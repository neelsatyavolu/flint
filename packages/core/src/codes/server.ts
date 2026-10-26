import { timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { ensureToken } from "../agent/token";
import { logger } from "../log";
import type { VerificationCode } from "../types";
import { SOCKET_MAX_LINE_BYTES, socketRequestSchema, type CodesPaths, type SocketError, type SocketResponse, type WireCode } from "./contract";
import type { CodeRegistry } from "./registry";

const log = logger("codes");

const AUTH_TIMEOUT_MS = 5_000;
const MAX_CONNECTIONS = 16;

export type CodesServerOptions = {
  paths: Pick<CodesPaths, "socketPath" | "tokenPath" | "pointerPath">;
  registry: CodeRegistry;
  /** False answers list/used with "disabled" (settings.codes.enabled is off). */
  isEnabled: () => boolean;
  /** Called after a code was marked used through the socket. */
  onUsed?: (code: VerificationCode) => void;
};

export type CodesServerHandle = { socketPath: string; close(): Promise<void> };

export const toWire = (c: VerificationCode): WireCode => ({ id: c.id, code: c.code, service: c.service, senderDomain: c.senderDomain, receivedAt: c.receivedAt });

const fail = (id: number, code: SocketError["code"], message: string): SocketResponse => ({ id, ok: false, error: { code, message } });

function sameToken(given: string, want: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

function tightenUmask(): number | null {
  try { return process.umask(0o177); } catch { return null; }
}

/** Serves list/used over a 0600 Unix socket to the native messaging host. Every connection must start with a token hello. */
export async function startCodesServer(opts: CodesServerOptions): Promise<CodesServerHandle> {
  const { socketPath, pointerPath, tokenPath } = opts.paths;
  const token = ensureToken(tokenPath);
  const sockets = new Set<Socket>();

  const handle = (req: unknown, id: number): SocketResponse => {
    const parsed = socketRequestSchema.safeParse(req);
    if (!parsed.success) return fail(id, "invalid", "Unknown request.");
    const r = parsed.data;
    if (r.op === "hello") return fail(r.id, "invalid", "Already signed in.");
    if (!opts.isEnabled()) return fail(r.id, "disabled", "Verification codes are turned off in Flint.");
    if (r.op === "list") return { id: r.id, ok: true, codes: opts.registry.list().map(toWire) };
    const code = opts.registry.get(r.codeId);
    if (!code) return fail(r.id, "not_found", "That code is gone.");
    opts.registry.markUsed(r.codeId);
    opts.onUsed?.({ ...code, used: true });
    return { id: r.id, ok: true };
  };

  const server: Server = createServer((socket) => {
    if (sockets.size >= MAX_CONNECTIONS) { socket.destroy(); return; }
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    let authed = false;
    let buffer = "";
    const send = (r: SocketResponse): void => { socket.write(`${JSON.stringify(r)}\n`); };
    const reject = (id: number, code: SocketError["code"], message: string): void => { socket.end(`${JSON.stringify(fail(id, code, message))}\n`); };
    const timer = setTimeout(() => { if (!authed) socket.destroy(); }, AUTH_TIMEOUT_MS);
    timer.unref();
    socket.on("close", () => clearTimeout(timer));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > SOCKET_MAX_LINE_BYTES * 2) return reject(0, "invalid", "Request too large.");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (Buffer.byteLength(line) > SOCKET_MAX_LINE_BYTES) return reject(0, "invalid", "Request too large.");
        if (!line.trim()) continue;
        let json: unknown;
        try { json = JSON.parse(line); } catch { return authed ? send(fail(0, "invalid", "Not JSON.")) : reject(0, "auth", "Sign in first."); }
        const id = typeof (json as { id?: unknown } | null)?.id === "number" ? (json as { id: number }).id : 0;
        if (!authed) {
          const parsed = socketRequestSchema.safeParse(json);
          if (!parsed.success || parsed.data.op !== "hello" || !sameToken(parsed.data.token, token)) return reject(id, "auth", "Sign in first.");
          authed = true;
          send({ id, ok: true });
          continue;
        }
        try {
          send(handle(json, id));
        } catch (error) {
          log.warn("codes request failed", { reason: (error as Error).message });
          send(fail(id, "internal", "Something went wrong inside Flint."));
        }
      }
    });
  });

  const dataDir = dirname(tokenPath);
  const socketDir = dirname(socketPath);
  mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  if (socketDir !== dataDir) chmodSync(socketDir, 0o700);
  rmSync(socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    const previous = tightenUmask();
    try {
      server.listen(socketPath, () => { server.off("error", reject); resolve(); });
    } finally {
      if (previous !== null) { try { process.umask(previous); } catch { /* nothing to restore */ } }
    }
  });
  chmodSync(socketPath, 0o600);
  if (socketDir === dataDir) rmSync(pointerPath, { force: true });
  else writeFileSync(pointerPath, socketPath, { mode: 0o600 });
  log.info("codes server listening");

  return {
    socketPath,
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => {
        rmSync(socketPath, { force: true });
        if (socketDir !== dataDir) rmSync(pointerPath, { force: true });
        resolve();
      });
    }),
  };
}
