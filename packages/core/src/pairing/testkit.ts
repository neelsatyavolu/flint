// Test helpers for the pairing suites: a fake Mac data source and a scripted phone.

import { connect, type Socket } from "node:net";
import type { Account, Rule, Settings, Signature, Template } from "../types";
import type { BundleSource } from "./bundle";
import { deriveSession, Direction, fromBase64Url, generateKeypair, open, seal, sharedSecret, toBase64Url, type Keypair, type SessionKeys } from "./crypto";
import { encodeFrame, FrameDecoder, FrameType, type Frame } from "./frames";
import { decodeOffer, type PairingOffer } from "./qr";

const account = (over: Partial<Account>): Account => ({
  id: "a1", email: "neel@example.com", name: "Neel", provider: "imap", authKind: "password", color: "#4C8DFF", sortOrder: 0, enabled: true,
  aliases: ["n@example.com"], createdAt: 1, showInUnified: true, avatarSource: null, avatarUpdatedAt: null,
  imapHost: "imap.example.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.example.com", smtpPort: 465, smtpSecure: true, username: "neel@example.com", ...over,
});

export const ACCOUNTS: Account[] = [
  account({}),
  account({ id: "a2", email: "neel@gmail.com", provider: "gmail", authKind: "oauth_google", showInUnified: false, sortOrder: 1, aliases: [], avatarSource: "google", avatarUpdatedAt: 5,
    imapHost: "imap.gmail.com", smtpHost: "smtp.gmail.com", username: "neel@gmail.com" }),
];

export function fakeSource(over: Partial<BundleSource> = {}): BundleSource {
  const secrets: Record<string, string> = { a1: "app-password-1", a2: "ya29.google-access-token" };
  return {
    deviceName: () => "Test Mac",
    listAccounts: async () => ACCOUNTS,
    password: async (id) => secrets[id] ?? null,
    avatar: async () => "data:image/png;base64,AAAA",
    listSignatures: async () => [{ id: 1, name: "Work", html: "<p>Neel</p>", accountIds: ["a1"], defaultNew: true, defaultReply: false } satisfies Signature],
    listTemplates: async () => [{ id: 1, name: "Thanks", subject: "Thanks", html: "<p>Thanks</p>" } satisfies Template],
    listRules: async () => [{ id: 1, name: "R", enabled: true, accountId: "a1", match: "all", conditions: [{ field: "from", op: "contains", value: "x@" }], actions: [{ type: "archive" }], sortOrder: 0 } satisfies Rule],
    listBlocked: async () => [{ pattern: "spam.example" }],
    getSettings: async () => ({
      appearance: { theme: "dark", density: "compact" }, inbox: { focused: true }, compose: { undoSendSeconds: 10 }, sync: { initialDays: 90, bodiesForRecentDays: 30 },
      receipts: { enabled: true, defaultOn: false, endpoint: "https://r.example.com", notifyOnOpen: true }, notifications: { scope: "people" },
      google: { clientId: "secret-client", clientSecret: "secret-secret" }, ai: { enabled: true }, agents: { enabled: true },
    }) as unknown as Settings,
    now: () => 1_790_000_000_000,
    ...over,
  };
}

/** A phone that speaks the protocol over a real socket. */
export class FakePhone {
  readonly decoder = new FrameDecoder();
  readonly frames: Frame[] = [];
  readonly keypair: Keypair = generateKeypair();
  keys: SessionKeys | null = null;
  closed = false;
  private waiters: (() => void)[] = [];

  constructor(readonly socket: Socket, readonly offer: PairingOffer) {
    socket.on("data", (d) => { this.frames.push(...this.decoder.push(d)); this.waiters.splice(0).forEach((w) => w()); });
    socket.on("close", () => { this.closed = true; this.waiters.splice(0).forEach((w) => w()); });
    socket.on("error", () => undefined);
  }

  static async join(url: string, host = "127.0.0.1"): Promise<FakePhone> {
    const offer = decodeOffer(url)!;
    const socket = connect({ host, port: offer.port });
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    return new FakePhone(socket, offer);
  }

  helloBody(name = "Test iPhone", sid = this.offer.sid): Buffer {
    return Buffer.from(JSON.stringify({ v: 1, sid: toBase64Url(sid), pk: toBase64Url(this.keypair.publicKey), name }));
  }

  sendHello(name?: string): void {
    this.keys = deriveSession(sharedSecret(this.keypair.privateKey, this.offer.pk), this.offer.sid, this.offer.pk, this.keypair.publicKey);
    this.socket.write(encodeFrame(FrameType.hello, this.helloBody(name)));
  }

  sendAck(counter = 0n, counts = { accounts: 2, signatures: 1, templates: 1, rules: 1, blockedSenders: 1 }): void {
    const sealed = seal(this.keys!.phoneToMac, this.offer.sid, Direction.phoneToMac, FrameType.ack, counter, Buffer.from(JSON.stringify(counts)));
    this.socket.write(encodeFrame(FrameType.ack, sealed));
  }

  /** Waits until `n` frames arrived or the socket closed. */
  async frameCount(n: number, timeoutMs = 2000): Promise<number> {
    const end = Date.now() + timeoutMs;
    while (this.frames.length < n && !this.closed && Date.now() < end) await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, 25); });
    return this.frames.length;
  }

  async untilClosed(timeoutMs = 2000): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (!this.closed && Date.now() < end) await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, 25); });
    return this.closed;
  }

  /** Opens every received BUNDLE frame with the right counters and joins the chunks. */
  receiveBundle(): Buffer {
    const parts: Buffer[] = [];
    this.frames.forEach((f, i) => {
      const plain = open(this.keys!.macToPhone, this.offer.sid, Direction.macToPhone, f.type, BigInt(i), f.body);
      if (f.type === FrameType.bundle) parts.push(plain.subarray(1));
    });
    return Buffer.concat(parts);
  }
}

export { fromBase64Url };
