import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCodeRegistry } from "@flint/core/codes/registry";
import { CODES_ALLOWED_ORIGIN, codesPaths } from "@flint/core/codes/contract";
import { wireCodes } from "@flint/core/service/codes";
import type { ServiceContext } from "@flint/core/service/context";
import { EventBus } from "@flint/core/service/events";
import { DEFAULT_SETTINGS } from "@flint/core/store/settings";
import { makeStore, msg, person, seedImap } from "@flint/core/store/testkit";
import { encodeFrame, runNativeHost } from "./nativeHost";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const BUILT = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "flint.js");

let dir: string;
let stop: () => void;
let ctx: ServiceContext;
let arrive: () => void;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "flint-e2e-"));
  const store = makeStore();
  const seed = seedImap(store);
  const bus = new EventBus();
  ctx = {
    store, bus, emit: bus.emit, now: () => NOW, caller: () => undefined, codes: createCodeRegistry(() => NOW),
    getSettings: () => DEFAULT_SETTINGS,
    platform: { dataDir: dir, notify: () => undefined },
  } as unknown as ServiceContext;
  stop = wireCodes(ctx, { startSocket: true });
  arrive = () => {
    const [o] = store.ingestMessages(seed.account.id, seed.inbox.id, [msg({
      uid: 1, subject: "Your sign-in code", from: [person("KAYAK", "no-reply@mail.kayak.com")], date: NOW - 60_000,
      htmlBody: "<p>Enter this code to finish signing in:</p><p><b>530331</b></p>",
    })], { evaluate: true });
    bus.emit({ type: "new_mail", accountId: seed.account.id, threadId: o!.threadId, from: person("x"), subject: "s", category: "people" });
  };
  for (let i = 0; i < 100 && !existsSync(codesPaths(dir).socketPath); i++) await new Promise((r) => setTimeout(r, 20));
});
afterEach(() => { stop(); rmSync(dir, { recursive: true, force: true }); });

function decode(buf: Buffer): unknown[] {
  const out: unknown[] = [];
  for (let o = 0; o < buf.length;) { const n = buf.readUInt32LE(o); out.push(JSON.parse(buf.subarray(o + 4, o + 4 + n).toString())); o += 4 + n; }
  return out;
}

describe("mail -> codes.sock -> flint native-host", () => {
  it("returns the detected code framed, then marks it used", async () => {
    arrive();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: Buffer[] = [];
    stdout.on("data", (d: Buffer) => chunks.push(d));
    const done = runNativeHost({ stdin, stdout, stderr: new PassThrough(), env: {}, dataDir: dir });
    stdin.write(encodeFrame({ type: "list", origin: "https://www.kayak.com" }));
    for (let i = 0; i < 100 && chunks.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    const [first] = decode(Buffer.concat(chunks)) as { ok: boolean; codes: { id: string; code: string; service: string; senderDomain: string }[] }[];
    expect(first).toMatchObject({ ok: true, codes: [{ code: "530331", service: "KAYAK", senderDomain: "kayak.com" }] });
    expect(JSON.stringify(first)).not.toMatch(/threadId|messageId|accountId/);
    stdin.write(encodeFrame({ type: "used", id: first!.codes[0]!.id }));
    stdin.write(encodeFrame({ type: "list", origin: "https://www.kayak.com" }));
    stdin.end();
    expect(await done).toBe(0);
    const replies = decode(Buffer.concat(chunks));
    expect(replies.slice(1)).toEqual([{ ok: true }, { ok: true, codes: [] }]);
  });

  it.skipIf(!existsSync(BUILT))("works through the built flint.js binary as a child process", async () => {
    arrive();
    const child = spawn(process.execPath, [BUILT, "native-host", CODES_ALLOWED_ORIGIN], { env: { ...process.env, FLINT_DATA_DIR: dir }, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stdin.end(encodeFrame({ type: "list", origin: "https://kayak.com" }));
    const code = await new Promise<number | null>((r) => child.on("close", r));
    expect(code).toBe(0);
    expect(decode(Buffer.concat(out))).toMatchObject([{ ok: true, codes: [{ code: "530331" }] }]);
  });

  it.skipIf(!existsSync(BUILT))("refuses to run without the browser's caller argument", async () => {
    arrive();
    const child = spawn(process.execPath, [BUILT, "native-host"], { env: { ...process.env, FLINT_DATA_DIR: dir }, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stdin.end(encodeFrame({ type: "list", origin: "" }));
    const code = await new Promise<number | null>((r) => child.on("close", r));
    expect(code).toBe(2);
    expect(Buffer.concat(out).length).toBe(0);
  });
});
