import { describe, expect, it } from "vitest";
import { loadFixture } from "../../fixtures";
import { canonicalAddress } from "./client";
import { injectPixel, newToken, normalizeEndpoint, pixelTag, pixelUrlFor } from "./pixel";
import { TOKEN_RE } from "./protocol";

const fixture = loadFixture<Record<string, any>, any, { tokenRegex: string }>("receipts-pixel");

describe("pixel", () => {
  it("makes 22 character base64url tokens that differ", () => {
    const a = newToken();
    expect(a).toMatch(TOKEN_RE);
    expect(newToken()).not.toBe(a);
  });

  it("pins the token pattern", () => expect(fixture.meta.tokenRegex).toBe(TOKEN_RE.source));

  it("uses the exact SPEC markup", () => {
    expect(pixelTag("https://r.example/i/abc.gif")).toBe(
      '<img src="https://r.example/i/abc.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />',
    );
  });
});

describe("receipts-pixel fixtures", () => {
  it.each(fixture.cases)("$name", ({ input, expect: want }) => {
    switch (input.fn) {
      case "canonicalAddress": return expect(canonicalAddress(input.address)).toBe(want);
      case "pixelTag": return expect(pixelTag(input.url)).toBe(want);
      case "injectPixel": return expect(injectPixel(input.html, input.pixelUrl)).toBe(want);
      case "normalizeEndpoint": return expect(normalizeEndpoint(input.endpoint)).toBe(want);
      case "pixelUrlFor": return expect(pixelUrlFor(input.endpoint, input.token)).toBe(want);
      case "tokenShape": return expect(TOKEN_RE.test(input.token)).toBe(want);
    }
  });
});
