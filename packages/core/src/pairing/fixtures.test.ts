import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBundle } from "./bundle";
import { Direction, deriveSession, open, publicFromPrivate, seal, sharedSecret } from "./crypto";
import { FrameDecoder, FrameError } from "./frames";
import { decodeOffer } from "./qr";
import { buildBundleFixture, buildVectors } from "./vectors";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const file = (name: string) => join(DIR, name);
const update = process.env.FLINT_FIXTURES_UPDATE === "1";
if (update) {
  writeFileSync(file("pairing-vectors.json"), JSON.stringify(buildVectors(), null, 2) + "\n");
  writeFileSync(file("pairing-bundle.json"), JSON.stringify(buildBundleFixture(), null, 2) + "\n");
}
const vectors = JSON.parse(readFileSync(file("pairing-vectors.json"), "utf8")) as ReturnType<typeof buildVectors>;
const bundleFixture = JSON.parse(readFileSync(file("pairing-bundle.json"), "utf8")) as ReturnType<typeof buildBundleFixture>;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const buf = (s: string) => Buffer.from(s, "hex");

describe("pairing-vectors.json", () => {
  it("is in sync with the generator", () => {
    expect(vectors).toEqual(JSON.parse(JSON.stringify(buildVectors())));
  });

  for (const c of vectors.cases.filter((x) => "macPrivate" in x.input)) {
    it(`derives ${c.name}`, () => {
      const input = c.input as { sid: string; macPrivate: string; phonePrivate: string };
      const expected = c.expect as Record<string, string>;
      const a = buf(input.macPrivate);
      const b = buf(input.phonePrivate);
      const pubA = publicFromPrivate(a);
      const pubB = publicFromPrivate(b);
      expect(hex(pubA)).toBe(expected.macPublic);
      expect(hex(pubB)).toBe(expected.phonePublic);
      const shared = sharedSecret(a, pubB);
      expect(hex(shared)).toBe(expected.shared);
      expect(hex(sharedSecret(b, pubA))).toBe(expected.shared);
      const keys = deriveSession(shared, buf(input.sid), pubA, pubB);
      expect(hex(keys.macToPhone)).toBe(expected.keyMacToPhone);
      expect(hex(keys.phoneToMac)).toBe(expected.keyPhoneToMac);
      expect(keys.sas).toBe(expected.sas);
    });
  }

  it("covers a code with leading zeros", () => {
    expect(vectors.cases.some((c) => (c.expect as { sas?: string }).sas?.startsWith("0"))).toBe(true);
  });

  for (const c of vectors.cases.filter((x) => "direction" in x.input)) {
    it(`seals and opens ${c.name}`, () => {
      const i = c.input as { sid: string; direction: keyof typeof Direction; type: number; counter: number; key: string; plaintext: string };
      const e = c.expect as { sealed: string; frame: string };
      const sealed = seal(buf(i.key), buf(i.sid), Direction[i.direction], i.type, BigInt(i.counter), buf(i.plaintext));
      expect(hex(sealed)).toBe(e.sealed);
      expect(hex(open(buf(i.key), buf(i.sid), Direction[i.direction], i.type, BigInt(i.counter), sealed))).toBe(i.plaintext);
      const frames = new FrameDecoder().push(buf(e.frame));
      expect(frames).toHaveLength(1);
      expect(frames[0]!.type).toBe(i.type);
      expect(hex(frames[0]!.body)).toBe(e.sealed);
    });
  }

  it("reads back the qr payload", () => {
    const c = vectors.cases.find((x) => x.name === "qr payload")!;
    const offer = decodeOffer((c.expect as { url: string }).url)!;
    expect(hex(offer.sid)).toBe((c.input as { sid: string }).sid);
    expect(offer.port).toBe(49152);
  });

  it("applies the framing rules", () => {
    for (const r of vectors.framing.rejects) expect(() => new FrameDecoder().push(buf(r.hex)), r.name).toThrow(FrameError);
    for (const r of vectors.framing.accepts) expect(new FrameDecoder().push(buf(r.hex)), r.name).toEqual([]);
  });
});

describe("pairing-bundle.json", () => {
  it("is in sync with the generator", () => {
    expect(bundleFixture).toEqual(JSON.parse(JSON.stringify(buildBundleFixture())));
  });
  for (const c of bundleFixture.cases) {
    it(c.name, () => {
      const e = c.expect as { valid: boolean; canonical?: unknown };
      if (e.valid) expect(JSON.parse(JSON.stringify(parseBundle(JSON.stringify(c.input))))).toEqual(e.canonical);
      else expect(() => parseBundle(JSON.stringify(c.input))).toThrow();
    });
  }
});
