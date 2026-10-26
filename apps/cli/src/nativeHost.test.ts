import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CODES_ALLOWED_ORIGIN, CODES_FIREFOX_ID, codesPaths, type SocketRequest, type SocketResponse, type WireCode } from "@flint/core/codes/contract";
import { encodeFrame, launchedByBrowser, MAX_REQUEST_BYTES, runNativeHost } from "./nativeHost";

const code: WireCode = { id: "c1", code: "530331", service: "KAYAK", senderDomain: "kayak.com", receivedAt: 1 };
let dir: string;
let server: Server | null;
let seen: SocketRequest[];

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flint-nh-")); server = null; seen = []; });
afterEach(() => { server?.close(); rmSync(dir, { recursive: true, force: true }); });

function startFake(opts: { token?: string; onOp?: (req: SocketRequest) => SocketResponse } = {}): Promise<void> {
  const paths = codesPaths(dir);
  writeFileSync(paths.tokenPath, "secret\n");
  const token = opts.token ?? "secret";
  return new Promise((resolve) => {
    server = createServer((sock: Socket) => {
      let buf = "";
      let authed = false;
      sock.on("data", (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf("\n")) !== -1) {
          const req = JSON.parse(buf.slice(0, i)) as SocketRequest;
          buf = buf.slice(i + 1);
          seen.push(req);
          if (!authed) {
            if (req.op !== "hello" || req.token !== token) { sock.end(JSON.stringify({ id: req.id, ok: false, error: { code: "auth", message: "no" } }) + "\n"); return; }
            authed = true;
            sock.write(JSON.stringify({ id: req.id, ok: true }) + "\n");
            continue;
          }
          const res = opts.onOp?.(req) ?? (req.op === "list" ? { id: req.id, ok: true, codes: [code] } : { id: req.id, ok: true });
          sock.write(JSON.stringify(res) + "\n");
        }
      });
    });
    server.listen(paths.socketPath, resolve);
  });
}

async function host(frames: Buffer[], chunkSize = Infinity): Promise<{ replies: unknown[]; exit: number }> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const out: Buffer[] = [];
  stdout.on("data", (d: Buffer) => out.push(d));
  const done = runNativeHost({ stdin, stdout, stderr: new PassThrough(), env: {}, dataDir: dir });
  const all = Buffer.concat(frames);
  for (let i = 0; i < all.length; i += chunkSize) { stdin.write(all.subarray(i, i + chunkSize)); await new Promise((r) => setImmediate(r)); }
  stdin.end();
  const exit = await done;
  const buf = Buffer.concat(out);
  const replies: unknown[] = [];
  for (let o = 0; o < buf.length;) { const n = buf.readUInt32LE(o); replies.push(JSON.parse(buf.subarray(o + 4, o + 4 + n).toString())); o += 4 + n; }
  return { replies, exit };
}

describe("launchedByBrowser", () => {
  it("accepts the Chrome origin and the Firefox add-on id, and nothing else", () => {
    expect(launchedByBrowser([CODES_ALLOWED_ORIGIN])).toBe(true);
    expect(launchedByBrowser(["/path/co.xanom.flint.codes.json", CODES_FIREFOX_ID])).toBe(true);
    expect(launchedByBrowser([])).toBe(false);
    expect(launchedByBrowser(["chrome-extension://someotherid/"])).toBe(false);
  });
});

describe("native-host", () => {
  it("lists codes with hello first and exits 0 on EOF", async () => {
    await startFake();
    const r = await host([encodeFrame({ type: "list", origin: "https://kayak.com" })]);
    expect(r.replies).toEqual([{ ok: true, codes: [code] }]);
    expect(r.exit).toBe(0);
    expect(seen[0]).toMatchObject({ op: "hello", token: "secret" });
    expect(seen[1]).toMatchObject({ op: "list", origin: "https://kayak.com" });
  });

  it("handles byte-by-byte delivery and pipelined requests in order", async () => {
    await startFake();
    const r = await host([encodeFrame({ type: "ping" }), encodeFrame({ type: "used", id: "c1" }), encodeFrame({ type: "list", origin: "x" })], 1);
    expect(r.replies).toEqual([{ ok: true, running: true }, { ok: true }, { ok: true, codes: [code] }]);
    expect(seen.some((s) => s.op === "used" && s.codeId === "c1")).toBe(true);
  });

  it("reports not_running with empty codes when Flint is not up", async () => {
    const r = await host([encodeFrame({ type: "list", origin: "x" }), encodeFrame({ type: "ping" }), encodeFrame({ type: "used", id: "c1" })]);
    expect(r.replies[0]).toMatchObject({ ok: false, codes: [], error: { code: "not_running" } });
    expect(r.replies[1]).toEqual({ ok: true, running: false });
    expect(r.replies[2]).toMatchObject({ ok: false, error: { code: "not_running" } });
    expect(r.exit).toBe(0);
  });

  it("reports not_running when the token exists but nothing listens", async () => {
    writeFileSync(codesPaths(dir).tokenPath, "secret");
    const r = await host([encodeFrame({ type: "list", origin: "x" })]);
    expect(r.replies[0]).toMatchObject({ ok: false, error: { code: "not_running" } });
  });

  it("maps auth, disabled and not_found errors", async () => {
    await startFake({ token: "other" });
    expect((await host([encodeFrame({ type: "list", origin: "x" })])).replies[0]).toMatchObject({ ok: false, error: { code: "auth" } });
    server?.close(); rmSync(codesPaths(dir).socketPath, { force: true });
    await startFake({ onOp: (req) => ({ id: req.id, ok: false, error: { code: req.op === "used" ? "not_found" : "disabled", message: "m" } }) });
    const r = await host([encodeFrame({ type: "list", origin: "x" }), encodeFrame({ type: "used", id: "zz" })]);
    expect(r.replies[0]).toMatchObject({ ok: false, error: { code: "disabled" } });
    expect(r.replies[1]).toMatchObject({ ok: false, error: { code: "invalid" } });
  });

  it("rejects unknown requests and bad JSON but keeps serving", async () => {
    await startFake();
    const bad = Buffer.alloc(4 + 3); bad.writeUInt32LE(3, 0); bad.write("{x}", 4);
    const r = await host([encodeFrame({ type: "nope" }), bad, encodeFrame({ type: "ping" })]);
    expect(r.replies).toEqual([
      { ok: false, error: { code: "invalid", message: "Unknown request." } },
      { ok: false, error: { code: "invalid", message: "Message is not valid JSON." } },
      { ok: true, running: true },
    ]);
  });

  it("discards an oversize message and keeps framing", async () => {
    await startFake();
    const big = Buffer.alloc(4 + MAX_REQUEST_BYTES + 1, 0x20); big.writeUInt32LE(MAX_REQUEST_BYTES + 1, 0);
    const r = await host([big, encodeFrame({ type: "ping" })], 4096);
    expect(r.replies).toEqual([{ ok: false, error: { code: "invalid", message: "Message too large." } }, { ok: true, running: true }]);
  });

  it("uses the socket pointer file when present", async () => {
    await startFake();
    const paths = codesPaths(dir);
    writeFileSync(paths.pointerPath, paths.socketPath + "\n");
    expect((await host([encodeFrame({ type: "ping" })])).replies).toEqual([{ ok: true, running: true }]);
  });
});
