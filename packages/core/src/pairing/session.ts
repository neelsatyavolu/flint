// One pairing session on the Mac: listen, wait for one phone, show a code, send the bundle on approval.
// Expiry 180 s, one successful session, at most 3 failed attempts, then close. No state survives (docs/ios/DESIGN-NOTES.md section 7).

import { createServer, type Server, type Socket } from "node:net";
import { BundleError, buildBundle, countPasswordAccounts, type BundleSource } from "./bundle";
import { Direction, generateKeypair, newSessionId, open, seal, type Keypair, type SessionKeys } from "./crypto";
import { type PairedDevicesStore } from "./devices";
import { chunkBundle, encodeFrame, FrameDecoder, FrameError, FrameType, type Frame } from "./frames";
import { deriveFor, parseHello } from "./handshake";
import { privateAddresses } from "./addresses";
import { encodeOffer } from "./qr";

export const SESSION_TTL_MS = 180_000;
export const HELLO_TIMEOUT_MS = 10_000;
/** The phone reviews the bundle before it acknowledges, including a Google sign-in per account, so this is generous. */
export const ACK_TIMEOUT_MS = 20 * 60_000;
export const MAX_STRIKES = 3;

export type AckCounts = { accounts: number; signatures: number; templates: number; rules: number; blockedSenders: number };
export type CloseReason = "expired" | "cancelled" | "denied" | "too_many_attempts" | "connection_lost" | "failed" | "no_ack" | "too_large";

export type PairingEvent =
  | { type: "listening"; url: string; expiresAt: number; port: number; addrs: string[] }
  | { type: "approval"; deviceName: string; sas: string; passwordAccounts: number }
  | { type: "sending" }
  | { type: "done"; deviceName: string; counts: AckCounts }
  | { type: "closed"; reason: CloseReason; bundleSent: boolean };

export type PairingDeps = {
  source: BundleSource;
  devices: PairedDevicesStore;
  onEvent: (event: PairingEvent) => void;
  now?: () => number;
  /** Interface to bind. Default 0.0.0.0, with connections accepted only on the advertised private addresses. */
  host?: string;
  /** Addresses to advertise and accept on; default the machine's private IPv4 addresses. */
  addrs?: string[];
  ttlMs?: number;
  helloTimeoutMs?: number;
  ackTimeoutMs?: number;
  maxStrikes?: number;
};

type Phase = "idle" | "listening" | "handshaking" | "approval" | "sending" | "closed";
type Active = { socket: Socket; decoder: FrameDecoder; keys?: SessionKeys; deviceName?: string; sendCounter: bigint; recvCounter: bigint };

export class PairingSession {
  private phase: Phase = "idle";
  private strikes = 0;
  private server: Server | null = null;
  private active: Active | null = null;
  private readonly sid = newSessionId();
  private mac: Keypair | null = generateKeypair();
  private timers = new Set<NodeJS.Timeout>();
  private addrs: string[] = [];
  /** True once the first bundle byte may have left, so a later failure cannot claim nothing was sent. */
  private bundleSent = false;

  constructor(private readonly deps: PairingDeps) {}

  get state(): Phase { return this.phase; }

  async start(): Promise<Extract<PairingEvent, { type: "listening" }>> {
    this.addrs = this.deps.addrs ?? privateAddresses();
    if (this.addrs.length === 0) {
      this.finish("failed");
      throw new Error("No private network found. Connect this Mac to Wi-Fi or Ethernet and try again.");
    }
    const server = createServer((socket) => this.onConnection(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, this.deps.host ?? "0.0.0.0", () => resolve());
    });
    server.on("error", () => this.finish("failed"));
    const port = (server.address() as { port: number }).port;
    const now = (this.deps.now ?? Date.now)();
    const ttl = this.deps.ttlMs ?? SESSION_TTL_MS;
    const url = encodeOffer({ sid: this.sid, pk: this.mac!.publicKey, addrs: this.addrs, port });
    this.phase = "listening";
    this.expiresAt = Date.now() + ttl;
    this.later(ttl, () => this.finish("expired"));
    const event = { type: "listening", url, expiresAt: now + ttl, port, addrs: this.addrs } as const;
    this.deps.onEvent(event);
    return event;
  }

  /** The user pressed Approve. Sends READY then the bundle, then waits for the phone's ACK. */
  async approve(opts: { includePasswords: boolean }): Promise<void> {
    const a = this.active;
    if (this.phase !== "approval" || !a?.keys) return;
    this.phase = "sending";
    this.clearTimers();
    this.deps.onEvent({ type: "sending" });
    try {
      const bundle = await buildBundle(this.deps.source, opts);
      const chunks = chunkBundle(Buffer.from(JSON.stringify(bundle)));
      this.bundleSent = true;
      this.sendSealed(a, FrameType.ready, Buffer.alloc(0));
      for (const chunk of chunks) this.sendSealed(a, FrameType.bundle, chunk);
      this.later(this.deps.ackTimeoutMs ?? ACK_TIMEOUT_MS, () => this.finish("no_ack"));
    } catch (error) {
      this.finish(isTooLarge(error) ? "too_large" : "failed");
    }
  }

  /** Cancel from the dialog. */
  cancel(): void { this.finish(this.phase === "approval" ? "denied" : "cancelled"); }

  // ---- connections ----

  private onConnection(socket: Socket): void {
    const allowed = this.phase === "listening" && socket.localAddress !== undefined && this.addrs.includes(stripV6(socket.localAddress));
    if (!allowed) { socket.destroy(); return; }
    this.phase = "handshaking";
    const a: Active = { socket, decoder: new FrameDecoder(), sendCounter: 0n, recvCounter: 0n };
    this.active = a;
    const helloTimer = this.later(this.deps.helloTimeoutMs ?? HELLO_TIMEOUT_MS, () => this.strike());
    socket.on("data", (data) => this.onData(a, data, helloTimer));
    socket.on("error", () => undefined);
    socket.on("close", () => { if (this.active === a) this.onSocketClosed(); });
  }

  private onSocketClosed(): void {
    if (this.phase === "handshaking") this.strike();
    else if (this.phase !== "closed") this.finish("connection_lost");
  }

  private onData(a: Active, data: Buffer, helloTimer: NodeJS.Timeout): void {
    let frames: Frame[];
    try { frames = a.decoder.push(data); } catch (e) { if (e instanceof FrameError) return this.onBadFrame(); throw e; }
    for (const frame of frames) {
      if (this.phase === "handshaking") {
        clearTimeout(helloTimer);
        this.timers.delete(helloTimer);
        this.onHello(a, frame);
      } else if (this.phase === "sending") {
        this.onAck(a, frame);
      } else {
        return this.finish("failed"); // anything after HELLO other than the ACK
      }
      if (this.isClosed()) return;
    }
  }

  private isClosed(): boolean { return this.phase === "closed"; }

  private onBadFrame(): void { if (this.phase === "handshaking") this.strike(); else this.finish("failed"); }

  private onHello(a: Active, frame: Frame): void {
    const hello = frame.type === FrameType.hello ? parseHello(frame.body, this.sid) : null;
    const keys = hello && this.mac ? deriveFor(this.mac, hello, this.sid) : null;
    if (!hello || !keys) return this.strike();
    a.keys = keys;
    a.deviceName = hello.deviceName;
    this.phase = "approval";
    void countPasswordAccounts(this.deps.source)
      .catch(() => 0)
      .then((passwordAccounts) => {
        if (this.phase === "approval") this.deps.onEvent({ type: "approval", deviceName: hello.deviceName, sas: keys.sas, passwordAccounts });
      });
  }

  private onAck(a: Active, frame: Frame): void {
    if (frame.type !== FrameType.ack || !a.keys) return this.finish("failed");
    try {
      const plain = open(a.keys.phoneToMac, this.sid, Direction.phoneToMac, FrameType.ack, a.recvCounter, frame.body);
      a.recvCounter += 1n;
      const counts = parseCounts(plain);
      if (!counts) return this.finish("failed");
      this.deps.devices.add({ deviceName: a.deviceName ?? "iPhone", pairedAt: (this.deps.now ?? Date.now)() });
      this.deps.onEvent({ type: "done", deviceName: a.deviceName ?? "iPhone", counts });
      this.finish(null);
    } catch {
      this.finish("failed");
    }
  }

  private sendSealed(a: Active, type: number, plain: Buffer): void {
    const sealed = seal(a.keys!.macToPhone, this.sid, Direction.macToPhone, type, a.sendCounter, plain);
    a.sendCounter += 1n;
    a.socket.write(encodeFrame(type, sealed));
  }

  // ---- failure and teardown ----

  private strike(): void {
    this.strikes += 1;
    this.active?.socket.destroy();
    this.active = null;
    if (this.strikes >= (this.deps.maxStrikes ?? MAX_STRIKES)) return this.finish("too_many_attempts");
    this.clearTimers();
    this.phase = "listening";
    this.later(this.remainingTtl, () => this.finish("expired"));
  }

  private expiresAt = 0;
  private get remainingTtl(): number { return Math.max(0, this.expiresAt - Date.now()); }

  private later(ms: number, fn: () => void): NodeJS.Timeout {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  private clearTimers(): void { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }

  /** Closes everything and wipes the keys. `reason` null means success (the done event was already sent). */
  private finish(reason: CloseReason | null): void {
    if (this.phase === "closed") return;
    this.phase = "closed";
    this.clearTimers();
    const a = this.active;
    this.active = null;
    a?.keys?.macToPhone.fill(0);
    a?.keys?.phoneToMac.fill(0);
    this.mac?.privateKey.fill(0);
    this.mac = null;
    a?.socket.destroy();
    this.server?.close();
    this.server = null;
    if (reason) this.deps.onEvent({ type: "closed", reason, bundleSent: this.bundleSent });
  }
}

const isTooLarge = (error: unknown): boolean => (error instanceof BundleError || error instanceof FrameError) && /too large/i.test(error.message);

const stripV6 = (address: string): string => address.replace(/^::ffff:/, "");

function parseCounts(plain: Buffer): AckCounts | null {
  try {
    const v = JSON.parse(plain.toString("utf8")) as Record<string, unknown>;
    const keys = ["accounts", "signatures", "templates", "rules", "blockedSenders"] as const;
    if (!keys.every((k) => Number.isInteger(v[k]) && (v[k] as number) >= 0 && (v[k] as number) < 1_000_000)) return null;
    return Object.fromEntries(keys.map((k) => [k, v[k]])) as AckCounts;
  } catch {
    return null;
  }
}
