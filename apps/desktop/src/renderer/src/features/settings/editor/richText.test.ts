import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, needsSourceMode, normalizeLink, readImageFile, sanitizeHtml } from "./richText";

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
