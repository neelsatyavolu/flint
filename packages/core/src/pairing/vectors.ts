// Builds packages/core/fixtures/pairing-vectors.json and pairing-bundle.json. Run through
// `FLINT_FIXTURES_UPDATE=1 pnpm exec vitest run src/pairing/fixtures.test.ts`; the Swift side reads copies.

import { Direction, deriveSession, nonceFor, publicFromPrivate, seal, sharedSecret, toBase64Url } from "./crypto";
import { encodeFrame, FrameType } from "./frames";
import { encodeOffer } from "./qr";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const fromHex = (s: string): Buffer => Buffer.from(s, "hex");

type KeySet = { name: string; sid: string; a: string; b: string };

/** Fixed, public, test-only keys. Nothing here is a secret. */
export const KEY_SETS: KeySet[] = [
  { name: "set 1", sid: "000102030405060708090a0b0c0d0e0f", a: "a0".repeat(32), b: "b1".repeat(32) },
  { name: "set 2", sid: "f0e0d0c0b0a090807060504030201000", a: "11".repeat(32), b: "22".repeat(32) },
];

/** Searches fixed seeds for one whose code starts with zeros, so the padding is covered. */
function paddedSasSet(): KeySet {
  for (let i = 1; i < 5000; i++) {
    const tag = i.toString(16).padStart(2, "0").slice(-2);
    const set = { name: "set with zero-padded code", sid: tag.repeat(16), a: "c3".repeat(31) + tag, b: "d4".repeat(31) + tag };
    if (derive(set).sas.startsWith("0")) return set;
  }
  throw new Error("no padded code found");
}

function derive(set: KeySet) {
  const a = fromHex(set.a);
  const b = fromHex(set.b);
  const pubA = publicFromPrivate(a);
  const pubB = publicFromPrivate(b);
  const shared = sharedSecret(a, pubB);
  const sid = fromHex(set.sid);
  return { pubA, pubB, shared, sid, ...deriveSession(shared, sid, pubA, pubB) };
}

function derivationCase(set: KeySet) {
  const d = derive(set);
  const reverse = sharedSecret(fromHex(set.b), d.pubA);
  if (!reverse.equals(d.shared)) throw new Error("shared secrets differ");
  return {
    name: set.name,
    input: { sid: set.sid, macPrivate: set.a, phonePrivate: set.b },
    expect: { macPublic: hex(d.pubA), phonePublic: hex(d.pubB), shared: hex(d.shared), keyMacToPhone: hex(d.macToPhone), keyPhoneToMac: hex(d.phoneToMac), sas: d.sas },
  };
}

function sealedCase(name: string, set: KeySet, direction: "macToPhone" | "phoneToMac", type: number, counter: number, plaintext: Buffer) {
  const d = derive(set);
  const key = direction === "macToPhone" ? d.macToPhone : d.phoneToMac;
  const sealed = seal(key, d.sid, Direction[direction], type, BigInt(counter), plaintext);
  return {
    name,
    input: { sid: set.sid, direction, type, counter, key: hex(key), plaintext: hex(plaintext) },
    expect: { nonce: hex(nonceFor(BigInt(counter))), sealed: hex(sealed), frame: hex(encodeFrame(type, sealed)) },
  };
}

export function buildVectors() {
  const sets = [...KEY_SETS, paddedSasSet()];
  const d1 = derive(KEY_SETS[0]!);
  const offer = { sid: d1.sid, pk: d1.pubA, addrs: ["192.168.1.20", "10.0.0.5"], port: 49152 };
  return {
    meta: { version: 1, module: "mac pairing crypto and framing", source: "packages/core/src/pairing/crypto.ts, frames.ts, qr.ts", note: "Test-only keys. Regenerate with FLINT_FIXTURES_UPDATE=1 pnpm exec vitest run src/pairing/fixtures.test.ts in packages/core." },
    cases: [
      ...sets.map(derivationCase),
      sealedCase("ready frame, counter 0", KEY_SETS[0]!, "macToPhone", FrameType.ready, 0, Buffer.alloc(0)),
      sealedCase("bundle chunk, counter 1", KEY_SETS[0]!, "macToPhone", FrameType.bundle, 1, Buffer.concat([Buffer.from([1]), Buffer.from('{"v":1}')])),
      sealedCase("ack from phone, counter 0", KEY_SETS[0]!, "phoneToMac", FrameType.ack, 0, Buffer.from('{"accounts":2,"signatures":1,"templates":0,"rules":12,"blockedSenders":3}')),
      sealedCase("large counter", KEY_SETS[1]!, "macToPhone", FrameType.bundle, 4294967296, Buffer.from([0, 65, 66, 67])),
      {
        name: "qr payload",
        input: { sid: hex(offer.sid), macPublic: hex(offer.pk), addrs: offer.addrs, port: offer.port },
        expect: { url: encodeOffer(offer) },
      },
      {
        name: "hello body",
        input: { sid: hex(d1.sid), phonePublic: hex(d1.pubB), name: "Neel's iPhone" },
        expect: { json: JSON.stringify({ v: 1, sid: toBase64Url(d1.sid), pk: toBase64Url(d1.pubB), name: "Neel's iPhone" }), frame: hex(encodeFrame(FrameType.hello, Buffer.from(JSON.stringify({ v: 1, sid: toBase64Url(d1.sid), pk: toBase64Url(d1.pubB), name: "Neel's iPhone" })))) },
      },
    ],
    framing: {
      maxFrame: 65536,
      rejects: [
        { name: "zero length", hex: "00000000" },
        { name: "length over the cap", hex: "00010001" },
        { name: "huge length", hex: "ffffffff" },
      ],
      accepts: [{ name: "length exactly at the cap header", hex: "00010000" }],
    },
  };
}

const server = (host: string, port: number, secure: boolean) => ({ host, port, secure });

export const SAMPLE_BUNDLE = {
  v: 1,
  createdAt: 1_790_000_000_000,
  device: { name: "Neel's MacBook Pro" },
  accounts: [
    { email: "neel@example.com", name: "Neel", provider: "imap", authKind: "password", imap: server("imap.example.com", 993, true), smtp: server("smtp.example.com", 465, true), username: "neel@example.com", color: "#4C8DFF", aliases: ["n@example.com"], showInUnified: true, sortOrder: 0, password: "app-password-sample" },
    { email: "neel@gmail.com", name: "Neel S", provider: "gmail", authKind: "oauth_google", imap: server("imap.gmail.com", 993, true), smtp: server("smtp.gmail.com", 465, true), username: "neel@gmail.com", aliases: [], showInUnified: false, sortOrder: 1 },
  ],
  signatures: [{ name: "Work", html: "<p>Neel</p>", accountEmails: ["neel@example.com"], defaultNew: true, defaultReply: false }],
  templates: [{ name: "Thanks", subject: "Thank you", html: "<p>Thanks!</p>" }],
  rules: [{
    name: "Receipts", enabled: true, accountEmail: null, match: "any", sortOrder: 0,
    conditions: [{ field: "from", op: "contains", value: "receipts@" }, { field: "has_attachment", op: "is_true", value: "" }],
    actions: [{ type: "category", category: "notifications" }, { type: "notify", enabled: false }, { type: "move", folderPath: "Receipts" }],
  }],
  blockedSenders: ["spam.example", "bad@example.org"],
  settings: { compose: { undoSendSeconds: 10 }, sync: { initialDays: 90 }, inbox: { focused: true }, receipts: { endpoint: "https://receipts.example.com" }, appearance: { theme: "dark" }, notifications: { scope: "people" } },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const mutate = (f: (b: typeof SAMPLE_BUNDLE & Record<string, unknown>) => void) => { const b = clone(SAMPLE_BUNDLE) as typeof SAMPLE_BUNDLE & Record<string, unknown>; f(b); return b; };
const empty = { v: 1, createdAt: 0, device: { name: "Mac" }, accounts: [], signatures: [], templates: [], rules: [], blockedSenders: [], settings: {} };

export function buildBundleFixture() {
  const valid = (name: string, input: unknown, canonical: unknown = input) => ({ name, input, expect: { valid: true, canonical } });
  const invalid = (name: string, input: unknown) => ({ name, input, expect: { valid: false } });
  const withExtra = mutate((b) => { (b as Record<string, unknown>).refreshToken = "must-not-survive"; (b.accounts[1] as Record<string, unknown>).accessToken = "x"; });
  const tooMany = mutate((b) => { b.accounts = Array.from({ length: 21 }, (_, i) => ({ ...clone(SAMPLE_BUNDLE.accounts[1]!), email: `a${i}@example.com` })) as never; });
  return {
    meta: { version: 1, module: "mac pairing bundle", source: "packages/core/src/pairing/bundle.ts", note: "Bundle v1. Decoders drop unknown keys and re-encode to `canonical`. Regenerate with FLINT_FIXTURES_UPDATE=1 pnpm exec vitest run src/pairing/fixtures.test.ts in packages/core." },
    allowedKeys: {
      bundle: ["v", "createdAt", "device", "accounts", "signatures", "templates", "rules", "blockedSenders", "settings"],
      account: ["email", "name", "provider", "authKind", "imap", "smtp", "username", "color", "aliases", "showInUnified", "sortOrder", "avatar", "password"],
      googleAccount: ["email", "name", "provider", "authKind", "imap", "smtp", "username", "color", "aliases", "showInUnified", "sortOrder", "avatar"],
    },
    cases: [
      valid("full bundle", SAMPLE_BUNDLE),
      valid("empty bundle", empty),
      valid("unknown keys are dropped", withExtra, SAMPLE_BUNDLE),
      invalid("unknown major version", mutate((b) => { b.v = 2 as never; })),
      invalid("missing accounts", mutate((b) => { delete (b as Record<string, unknown>).accounts; })),
      invalid("port out of range", mutate((b) => { b.accounts[0]!.imap.port = 0; })),
      invalid("bad rule action", mutate((b) => { b.rules[0]!.actions = [{ type: "delete_everything" } as never]; })),
      invalid("password is not a string", mutate((b) => { (b.accounts[0] as Record<string, unknown>).password = 7; })),
      invalid("setting out of range", mutate((b) => { b.settings.compose.undoSendSeconds = 7 as never; })),
      invalid("too many accounts", tooMany),
      invalid("not an object", [1, 2, 3]),
    ],
  };
}
