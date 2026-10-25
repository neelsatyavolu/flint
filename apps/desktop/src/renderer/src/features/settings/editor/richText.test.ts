import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, applyFlintFont, hasCustomFont, needsSourceMode, normalizeLink, readImageFile, sanitizeHtml } from "./richText";

describe("normalizeLink", () => {
  it("keeps allowed schemes", () => {
    expect(normalizeLink("https://a.com")).toBe("https://a.com");
    expect(normalizeLink("mailto:a@b.co")).toBe("mailto:a@b.co");
  });
  it("adds a scheme to bare hosts and emails", () => {
    expect(normalizeLink("northwind.example/cal")).toBe("https://northwind.example/cal");
    expect(normalizeLink("a@b.co")).toBe("mailto:a@b.co");
  });
  it("rejects scripts and junk", () => {
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("not a link")).toBeNull();
    expect(normalizeLink("  ")).toBeNull();
  });
});

describe("needsSourceMode", () => {
  it("flags tables and inline styles", () => {
    expect(needsSourceMode("<table><tr><td>x</td></tr></table>")).toBe(true);
    expect(needsSourceMode('<p style="color:red">x</p>')).toBe(true);
    expect(needsSourceMode("<p>Thanks,<br>Alex</p>")).toBe(false);
  });
});

describe("sanitizeHtml", () => {
  it("strips scripts and handlers", () => {
    const out = sanitizeHtml('<p onclick="x()">hi</p><script>alert(1)</script>');
    expect(out).not.toContain("script");
    expect(out).not.toContain("onclick");
    expect(out).toContain("hi");
  });
});

describe("readImageFile", () => {
  it("converts an image to a data url", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    const r = await readImageFile(file);
    expect(r.ok && r.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
  it("rejects non-images and big files", async () => {
    expect((await readImageFile(new File(["x"], "a.txt", { type: "text/plain" }))).ok).toBe(false);
    const big = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "b.png", { type: "image/png" });
    expect((await readImageFile(big)).ok).toBe(false);
  });
});

describe("applyFlintFont", () => {
  const spark = '<div style="font-family: Helvetica; font-size: 13px; color:#333"><font face="Arial" size="3" color="#f00">Hi</font> <b style="font:bold 12px Verdana">Neel</b> <a href="https://x.org" style="font-family:Georgia;text-decoration:none">x</a><img src="https://x.org/a.png" width="40"></div>';
  it("drops typeface and size and keeps bold, color, links and images", () => {
    const out = applyFlintFont(spark);
    expect(out).not.toMatch(/font-family|font-size|face=|size=|Helvetica|Verdana|Georgia/);
    expect(out).toContain('style="color:#333"');
    expect(out).toContain('color="#f00"');
    expect(out).toContain("font-weight:bold");
    expect(out).toContain('href="https://x.org"');
    expect(out).toContain("<img");
  });
  it("leaves a signature without fonts alone", () => {
    expect(applyFlintFont("<p>Thanks,<br>Neel</p>")).toBe("<p>Thanks,<br>Neel</p>");
  });
  it("hasCustomFont sees what the transform removes", () => {
    expect(hasCustomFont(spark)).toBe(true);
    expect(hasCustomFont(applyFlintFont(spark))).toBe(false);
    expect(hasCustomFont("<p><b>Neel</b></p>")).toBe(false);
  });
});
