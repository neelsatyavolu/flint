import { describe, expect, it } from "vitest";
import { parseAttachmentUrl, sniffImageType } from "./attachment-url";

describe("parseAttachmentUrl", () => {
  it("reads a plain id", () => expect(parseAttachmentUrl("flint-attachment://42")).toBe(42));
  it("reads the IPv4 form the URL parser produces for numeric hosts", () => {
    expect(parseAttachmentUrl("flint-attachment://0.0.0.3/")).toBe(3);
    expect(parseAttachmentUrl("flint-attachment://0.0.1.0/")).toBe(256);
  });
  it("rejects anything else", () => {
    for (const bad of ["flint-attachment://", "flint-attachment://abc", "flint-attachment://1/../etc", "flint-attachment://0", "flint-attachment://1.2.3", "flint-attachment://999.0.0.1", "https://3"]) {
      expect(parseAttachmentUrl(bad)).toBeNull();
    }
  });
});

describe("sniffImageType", () => {
  it("detects common image types", () => {
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0]))).toBe("image/png");
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(Buffer.from("<svg xmlns='x'/>"))).toBe("image/svg+xml");
  });
  it("never claims HTML or unknown bytes are an image", () => {
    expect(sniffImageType(Buffer.from("<html><script>alert(1)</script>"))).toBe("application/octet-stream");
  });
});
