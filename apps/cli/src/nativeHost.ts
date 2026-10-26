import type { Readable, Writable } from "node:stream";
import { listCodes, markUsed, type CodesClientResult } from "@flint/core/codes/client";
import { CODES_ALLOWED_ORIGIN, CODES_FIREFOX_ID, nativeRequestSchema, type NativeRequest, type NativeResponse } from "@flint/core/codes/contract";
import { defaultDataDir } from "@flint/core/agent/paths";

/**
 * `flint native-host`: speaks browser native messaging (4-byte little-endian length + JSON) on stdin/stdout and
 * forwards to codes.sock (see packages/core/src/codes/contract.ts for both protocols).
 * Dispatched from main.ts before commander runs, so stdout carries only protocol frames. Internal: hidden from
 * --help and from the agent guide. Every location comes from `io` so tests use temp dirs and fake sockets.
 */
export type NativeHostIo = {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  env: Record<string, string | undefined>;
  /** Overrides the data dir (default: FLINT_DATA_DIR or the platform default). */
  dataDir?: string;
};

/**
 * Browsers launch the host with the caller's identity as an argument: Chrome passes `chrome-extension://<id>/`, Firefox passes
 * the manifest path and the add-on id. Refusing anything else stops `flint native-host` typed by hand or by an agent from
 * reading codes. This is a speed bump, not a lock: the arguments can be faked by anyone who can run the command, and the
 * token file is readable by the same user. Agents with shell access can reach codes; the agent API cannot.
 */
export function launchedByBrowser(args: readonly string[]): boolean {
  return args.some((a) => a === CODES_ALLOWED_ORIGIN || a === CODES_FIREFOX_ID);
}

/** Requests are tiny; anything bigger is not from our extension. */
export const MAX_REQUEST_BYTES = 64 * 1024;
/** Browsers cap host-to-browser messages at 1 MB. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;

export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const frame = Buffer.alloc(4 + body.length);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

const fail = (code: Extract<NativeResponse, { ok: false }>["error"]["code"], message: string): NativeResponse => ({ ok: false, error: { code, message } });

function fromClient<T>(r: CodesClientResult<T>, ok: (value: T) => NativeResponse): NativeResponse {
  if (r.ok) return ok(r.value);
  const code = r.error.code === "not_found" ? "invalid" : r.error.code;
  return fail(code, r.error.message);
}

async function handle(dataDir: string, req: NativeRequest): Promise<NativeResponse> {
  switch (req.type) {
    case "ping": {
      const r = await listCodes(dataDir);
      if (r.ok) return { ok: true, running: true };
      // Running but codes turned off or token rejected still means the app is up.
      return { ok: true, running: r.error.code !== "not_running" && r.error.code !== "internal" };
    }
    case "list": {
      const res = fromClient(await listCodes(dataDir, req.origin), (codes) => ({ ok: true, codes }));
      return res.ok ? res : ({ ...res, codes: [] } as NativeResponse);
    }
    case "used":
      return fromClient(await markUsed(dataDir, req.id), () => ({ ok: true }));
  }
}

async function respond(dataDir: string, payload: unknown): Promise<NativeResponse> {
  const parsed = nativeRequestSchema.safeParse(payload);
  if (!parsed.success) return fail("invalid", "Unknown request.");
  try {
    return await handle(dataDir, parsed.data);
  } catch (err) {
    return fail("internal", err instanceof Error ? err.message : "Unexpected error.");
  }
}

/** Resolves with the exit code once stdin closes. */
export function runNativeHost(io: NativeHostIo): Promise<number> {
  const dataDir = io.dataDir ?? defaultDataDir(io.env as NodeJS.ProcessEnv);
  return new Promise((resolve) => {
    let pending: Buffer = Buffer.alloc(0);
    let skip = 0;            // bytes of an oversize body still to discard
    let queue: Promise<void> = Promise.resolve();
    let exitCode = 0;

    const send = (value: NativeResponse) => {
      let frame = encodeFrame(value);
      if (frame.length - 4 > MAX_RESPONSE_BYTES) frame = encodeFrame(fail("internal", "Response too large."));
      io.stdout.write(frame);
    };
    const enqueue = (payload: unknown) => {
      queue = queue.then(async () => send(await respond(dataDir, payload)));
    };

    const drain = () => {
      for (;;) {
        if (skip > 0) {
          const n = Math.min(skip, pending.length);
          pending = pending.subarray(n);
          skip -= n;
          if (skip > 0) return;
        }
        if (pending.length < 4) return;
        const len = pending.readUInt32LE(0);
        if (len > MAX_REQUEST_BYTES) {
          // Cannot trust the stream position cheaply, but discarding the declared body keeps framing intact.
          queue = queue.then(() => send(fail("invalid", "Message too large.")));
          pending = pending.subarray(4);
          skip = len;
          continue;
        }
        if (pending.length < 4 + len) return;
        const body = pending.subarray(4, 4 + len).toString("utf8");
        pending = pending.subarray(4 + len);
        let payload: unknown;
        try { payload = JSON.parse(body); } catch { queue = queue.then(() => send(fail("invalid", "Message is not valid JSON."))); continue; }
        enqueue(payload);
      }
    };

    const finish = () => { void queue.then(() => resolve(exitCode)); };
    io.stdin.on("data", (chunk: Buffer | string) => {
      pending = Buffer.concat([pending, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
      drain();
    });
    io.stdin.on("end", finish);
    io.stdin.on("close", finish);
    io.stdin.on("error", (err) => { io.stderr.write(`native-host: ${err.message}\n`); exitCode = 1; finish(); });
  });
}
