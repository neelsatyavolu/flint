import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPrivateIPv4, privateAddresses } from "./addresses";
import { generateKeypair, newSessionId, open, seal, Direction, PairingCryptoError, nonceFor, fromBase64Url, sharedSecret } from "./crypto";
import { fileDevicesStore } from "./devices";
import { chunkBundle, encodeFrame, FrameDecoder, FrameError, MAX_BUNDLE_BYTES } from "./frames";
import { cleanDeviceName } from "./handshake";
import { decodeOffer, encodeOffer, renderQrSvg } from "./qr";

describe("addresses", () => {
  it("accepts only private IPv4 ranges", () => {
    expect(["10.1.2.3", "172.16.0.1", "172.31.9.9", "192.168.1.20"].every(isPrivateIPv4)).toBe(true);
    expect(["8.8.8.8", "172.32.0.1", "169.254.1.1", "127.0.0.1", "192.169.0.1", "300.1.1.1", "fe80::1"].some(isPrivateIPv4)).toBe(false);
  });
  it("lists up to three, Wi-Fi first, skipping loopback and v6", () => {
    const iface = (address: string, family: "IPv4" | "IPv6" = "IPv4", internal = false) => ({ address, family, internal, netmask: "", mac: "", cidr: null });
    const out = privateAddresses({
      utun3: [iface("10.9.9.9")], lo0: [iface("127.0.0.1", "IPv4", true)], en0: [iface("192.168.1.20"), iface("fe80::1", "IPv6")],
      en5: [iface("10.0.0.5")], bridge0: [iface("172.16.1.1")], awdl0: [iface("8.8.8.8")],
    } as never);
    expect(out).toHaveLength(3);
    expect(out.slice(0, 2).sort()).toEqual(["10.0.0.5", "192.168.1.20"]);
    expect(out).not.toContain("8.8.8.8");
  });
});

describe("crypto edge cases", () => {
  const key = Buffer.alloc(32, 7);
  const sid = newSessionId();
  it("fails to open with a different counter, direction, type, sid or key", () => {
    const sealed = seal(key, sid, Direction.macToPhone, 3, 4n, Buffer.from("hi"));
    expect(open(key, sid, Direction.macToPhone, 3, 4n, sealed).toString()).toBe("hi");
    expect(() => open(key, sid, Direction.macToPhone, 3, 5n, sealed)).toThrow(PairingCryptoError);
    expect(() => open(key, sid, Direction.phoneToMac, 3, 4n, sealed)).toThrow(PairingCryptoError);
    expect(() => open(key, sid, Direction.macToPhone, 2, 4n, sealed)).toThrow(PairingCryptoError);
    expect(() => open(key, newSessionId(), Direction.macToPhone, 3, 4n, sealed)).toThrow(PairingCryptoError);
    expect(() => open(Buffer.alloc(32, 8), sid, Direction.macToPhone, 3, 4n, sealed)).toThrow(PairingCryptoError);
    expect(() => open(key, sid, Direction.macToPhone, 3, 4n, sealed.subarray(0, 5))).toThrow(/short/);
  });
  it("builds nonces and validates counters", () => {
    expect(nonceFor(1n).toString("hex")).toBe("000000000000000000000001");
    expect(() => nonceFor(-1n)).toThrow();
    expect(() => nonceFor(1n << 64n)).toThrow();
  });
  it("rejects weak and wrong-sized keys", () => {
    const kp = generateKeypair();
    expect(() => sharedSecret(kp.privateKey, Buffer.alloc(32))).toThrow(/weak/);
    expect(() => sharedSecret(kp.privateKey, Buffer.alloc(31))).toThrow(/32 bytes/);
  });
  it("decodes base64url strictly", () => {
    expect(fromBase64Url("AQID")?.toString("hex")).toBe("010203");
    expect(fromBase64Url("A+/=")).toBeNull();
    expect(fromBase64Url(5)).toBeNull();
  });
});

describe("frames", () => {
  it("reassembles frames split across reads and returns several at once", () => {
    const d = new FrameDecoder();
    const wire = Buffer.concat([encodeFrame(1, Buffer.from("abc")), encodeFrame(2, Buffer.alloc(0))]);
    expect(d.push(wire.subarray(0, 3))).toEqual([]);
    expect(d.push(wire.subarray(3, 6))).toEqual([]);
    const out = d.push(wire.subarray(6));
    expect(out.map((f) => [f.type, f.body.length])).toEqual([[1, 3], [2, 0]]);
  });
  it("refuses to encode or decode oversize frames and chunk oversize bundles", () => {
    expect(() => encodeFrame(1, Buffer.alloc(65536))).toThrow(FrameError);
    expect(() => new FrameDecoder().push(Buffer.from([0, 1, 0, 1]))).toThrow(FrameError);
    expect(() => chunkBundle(Buffer.alloc(MAX_BUNDLE_BYTES + 1))).toThrow(/too large/);
  });
  it("splits a bundle into chunks that fit a frame, flagging the last", () => {
    const chunks = chunkBundle(Buffer.alloc(100_000, 1));
    expect(chunks.map((c) => c[0])).toEqual([0, 0, 0, 1]);
    expect(chunks.every((c) => encodeFrame(3, Buffer.concat([c, Buffer.alloc(16)])).length <= 65536 + 4)).toBe(true);
    expect(chunkBundle(Buffer.alloc(0)).map((c) => c[0])).toEqual([1]);
  });
});

describe("qr", () => {
  const offer = { sid: newSessionId(), pk: generateKeypair().publicKey, addrs: ["192.168.1.2"], port: 5000 };
  it("round-trips an offer and rejects malformed ones", () => {
    expect(decodeOffer(encodeOffer(offer))).toEqual(offer);
    expect(decodeOffer("https://example.com")).toBeNull();
    expect(decodeOffer("flint://pair#!!!")).toBeNull();
    const bad = (o: object) => "flint://pair#" + Buffer.from(JSON.stringify(o)).toString("base64url");
    const good = { v: 1, sid: offer.sid.toString("base64url"), pk: offer.pk.toString("base64url"), addrs: ["1.2.3.4"], port: 80 };
    expect(decodeOffer(bad(good))).not.toBeNull();
    for (const patch of [{ v: 2 }, { sid: "AA" }, { pk: "AA" }, { addrs: [] }, { addrs: ["1", "2", "3", "4"] }, { port: 0 }, { port: 70000 }, { addrs: [5] }]) expect(decodeOffer(bad({ ...good, ...patch }))).toBeNull();
    expect(decodeOffer("flint://pair#" + Buffer.from("nope").toString("base64url"))).toBeNull();
  });
  it("renders svg", async () => {
    expect(await renderQrSvg(encodeOffer(offer))).toContain("<svg");
  });
});

describe("device names and the devices file", () => {
  it("strips control characters and caps length", () => {
    expect(cleanDeviceName("  Neel\u0000's\n iPhone‮  ")).toBe("Neel 's iPhone");
    expect(cleanDeviceName("x".repeat(200))).toHaveLength(64);
  });
  it("stores only name and date, newest first, and survives a corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "flint-devices-"));
    try {
      const store = fileDevicesStore(join(dir, "sub", "devices.json"));
      expect(store.list()).toEqual([]);
      store.add({ deviceName: "A", pairedAt: 1 });
      store.add({ deviceName: "B", pairedAt: 2 });
      expect(store.list().map((d) => d.deviceName)).toEqual(["B", "A"]);
      store.remove(2);
      expect(store.list()).toEqual([{ deviceName: "A", pairedAt: 1 }]);
      writeFileSync(join(dir, "bad.json"), "{{{");
      expect(fileDevicesStore(join(dir, "bad.json")).list()).toEqual([]);
      writeFileSync(join(dir, "odd.json"), JSON.stringify([{ deviceName: 3 }, { deviceName: "ok", pairedAt: 5, extra: "x" }]));
      expect(fileDevicesStore(join(dir, "odd.json")).list()).toEqual([{ deviceName: "ok", pairedAt: 5 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
