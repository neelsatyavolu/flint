import { describe, expect, it } from "vitest";
import { injectPixel, newToken, normalizeEndpoint, pixelTag, pixelUrlFor } from "./pixel";
import { TOKEN_RE } from "./protocol";

describe("pixel", () => {
  it("makes 22 character base64url tokens that differ", () => {
    const a = newToken();
    expect(a).toMatch(TOKEN_RE);
    expect(newToken()).not.toBe(a);
  });

  it("uses the exact SPEC markup", () => {
    expect(pixelTag("https://r.example/i/abc.gif")).toBe(
      '<img src="https://r.example/i/abc.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />',
    );
  });

  it("puts the pixel first inside body", () => {
    const out = injectPixel('<html><body class="x"><p>Hi</p></body></html>', "https://r/i/t.gif");
    expect(out.indexOf("<img")).toBe(out.indexOf('<body class="x">') + '<body class="x">'.length);
    expect(out.endsWith("<p>Hi</p></body></html>")).toBe(true);
  });

  it("matches an uppercase body tag and prepends when there is none", () => {
    expect(injectPixel("<BODY>x</BODY>", "u")).toMatch(/^<BODY><img /);
    expect(injectPixel("<p>x</p>", "u").startsWith("<img ")).toBe(true);
  });

  it("escapes the url in the attribute", () => {
    expect(pixelTag('https://r/i/a"b&c')).toContain('src="https://r/i/a&quot;b&amp;c"');
  });

  it("normalizes endpoints", () => {
    expect(normalizeEndpoint(" https://r.example/ ")).toBe("https://r.example");
    expect(normalizeEndpoint("")).toBeNull();
    expect(normalizeEndpoint("not a url")).toBeNull();
    expect(normalizeEndpoint("ftp://r.example")).toBeNull();
    expect(pixelUrlFor("https://r.example", "tok")).toBe("https://r.example/i/tok.gif");
  });
});
