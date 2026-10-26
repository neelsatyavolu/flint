/**
 * Client for codes.sock (protocol in contract.ts). One short connection per request: connect, hello, op, close.
 * Used by `flint native-host`. Every location comes from `dataDir`, so tests use temp dirs.
 */
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { codesPaths, SOCKET_MAX_LINE_BYTES, type SocketError, type SocketRequest, type SocketResponse, type WireCode } from "./contract";

export type CodesClientResult<T> = { ok: true; value: T } | { ok: false; error: SocketError | { code: "not_running"; message: string } };

const NOT_RUNNING = { code: "not_running", message: "Flint isn't running. Open Flint, then try again." } as const;
const DEFAULT_TIMEOUT_MS = 3000;

async function readTrimmed(path: string): Promise<string | null> {
  try {
    const text = (await readFile(path, "utf8")).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** The socket path the running app advertises (pointer file) or the default for this data dir. */
export async function resolveSocketPath(dataDir: string): Promise<string> {
  const paths = codesPaths(dataDir);
  return (await readTrimmed(paths.pointerPath)) ?? paths.socketPath;
}

type Op = Exclude<SocketRequest, { op: "hello" }> extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

/** Sends `hello` then `op` over a fresh connection and resolves with the second response. Never rejects. */
export function codesRequest(dataDir: string, op: Op, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<CodesClientResult<SocketResponse & { ok: true }>> {
  return (async () => {
    const [socketPath, token] = await Promise.all([resolveSocketPath(dataDir), readTrimmed(codesPaths(dataDir).tokenPath)]);
    if (token === null) return { ok: false, error: NOT_RUNNING } as const;
    return exchange(socketPath, token, op, timeoutMs);
  })();
}

function exchange(socketPath: string, token: string, op: Op, timeoutMs: number): Promise<CodesClientResult<SocketResponse & { ok: true }>> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let done = false;
    const finish = (result: CodesClientResult<SocketResponse & { ok: true }>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: { code: "internal", message: "Flint did not answer in time." } }), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id: 1, op: "hello", token })}\n${JSON.stringify({ ...op, id: 2 })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > SOCKET_MAX_LINE_BYTES * 8) return finish({ ok: false, error: { code: "internal", message: "Response too large." } });
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        let res: SocketResponse;
        try { res = JSON.parse(line) as SocketResponse; } catch { return finish({ ok: false, error: { code: "internal", message: "Bad response from Flint." } }); }
        if (!res.ok) return finish({ ok: false, error: res.error });
        if (res.id === 2) return finish({ ok: true, value: res });
      }
    });
    socket.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT" || err.code === "ECONNREFUSED" || err.code === "ENOTSOCK") return finish({ ok: false, error: NOT_RUNNING });
      finish({ ok: false, error: { code: "internal", message: err.message } });
    });
    socket.on("close", () => finish({ ok: false, error: { code: "internal", message: "Flint closed the connection." } }));
  });
}

export async function listCodes(dataDir: string, origin?: string): Promise<CodesClientResult<WireCode[]>> {
  const r = await codesRequest(dataDir, origin === undefined ? { op: "list" } : { op: "list", origin });
  return r.ok ? { ok: true, value: r.value.codes ?? [] } : r;
}

export async function markUsed(dataDir: string, codeId: string): Promise<CodesClientResult<null>> {
  const r = await codesRequest(dataDir, { op: "used", codeId });
  return r.ok ? { ok: true, value: null } : r;
}
