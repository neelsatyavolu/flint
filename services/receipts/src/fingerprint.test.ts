import { describe, expect, it } from "vitest";
import { constantTimeEqual, fingerprintIp, installFingerprint, normalizeIp, sha256Hex } from "./fingerprint";
import { PIXEL_GIF, pixelResponse } from "./gif";
import { isApplePrivateRelayIp } from "./apple";

describe("fingerprint", () => {
  it("is deterministic, salted and 32 hex chars", async () => {
    const a = await fingerprintIp("s1", "203.0.113.5");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await fingerprintIp("s1", "203.0.113.5")).toBe(a);
    expect(await fingerprintIp("s2", "203.0.113.5")).not.toBe(a);
    expect(a).not.toContain("203");
  });
  it("hashes IPv6 by /64 and unwraps v4-mapped", async () => {
    expect(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:0db8:0001:0002");
    expect(normalizeIp("2001:db8::1")).toBe("2001:0db8:0000:0000");
    expect(normalizeIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(await fingerprintIp("s", "2001:db8:1:2::1")).toBe(await fingerprintIp("s", "2001:db8:1:2:ffff::9"));
  });
  it("install re-hash differs per install", async () => {
    const fp = await fingerprintIp("s", "1.2.3.4");
    const a = await installFingerprint("s", "inst-a", fp);
    expect(a).not.toBe(await installFingerprint("s", "inst-b", fp));
    expect(a).not.toBe(fp);
  });
  it("constantTimeEqual", async () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(await sha256Hex("a")).toHaveLength(64);
  });
});

describe("gif", () => {
  it("is 43 bytes and a GIF", async () => {
    expect(PIXEL_GIF.length).toBe(43);
    expect(String.fromCharCode(...PIXEL_GIF.slice(0, 6))).toBe("GIF89a");
    const r = pixelResponse();
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    expect(r.headers.get("Pragma")).toBe("no-cache");
    expect(r.headers.get("Expires")).toBe("0");
    expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("apple ranges", () => {
  it("matches known relay addresses and rejects others", () => {
    expect(isApplePrivateRelayIp("172.224.226.5")).toBe(true);
    expect(isApplePrivateRelayIp("::ffff:172.224.226.5")).toBe(true);
    expect(isApplePrivateRelayIp("2a02:26f7:b000::1")).toBe(true);
    expect(isApplePrivateRelayIp("8.8.8.8")).toBe(false);
    expect(isApplePrivateRelayIp("2001:db8::1")).toBe(false);
    expect(isApplePrivateRelayIp("garbage")).toBe(false);
    expect(isApplePrivateRelayIp("1.2.3")).toBe(false);
    expect(isApplePrivateRelayIp("1:2:3")).toBe(false);
    expect(isApplePrivateRelayIp(null)).toBe(false);
  });
});
