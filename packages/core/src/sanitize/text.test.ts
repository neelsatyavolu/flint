import { describe, expect, it } from "vitest";
import { cleanCss, decodeCssEscapes } from "./css";
import { htmlToText, snippetFrom } from "./htmlToText";
import { hostOf, isReceiptsUrl, looksLikePixelUrl, matchesTrackerRule } from "./trackers";

describe("htmlToText", () => {
  it("converts paragraphs, lists and links, and drops images and styles", () => {
    const text = htmlToText(`<style>p{color:red}</style><p>Hello <b>Ann</b></p><ul><li>One</li><li>Two</li></ul><a href="https://x.example/a">docs</a><img src="https://x.example/p.gif">`);
    expect(text).toContain("Hello Ann");
    expect(text).toMatch(/\* One/);
    expect(text).toContain("docs (https://x.example/a)");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("p.gif");
  });

  it("returns an empty string for empty input and collapses blank runs", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("<p>a</p><br><br><br><br><p>b</p>")).not.toMatch(/\n{3,}/);
  });

  it("hides a link target that equals its text", () => {
    expect(htmlToText(`<a href="https://x.example">https://x.example</a>`)).toBe("https://x.example");
  });

  it("wraps when asked", () => {
    const text = htmlToText(`<p>${"word ".repeat(40)}</p>`, { wordwrap: 40 });
    expect(Math.max(...text.split("\n").map((l) => l.length))).toBeLessThanOrEqual(40);
  });
});

describe("snippetFrom", () => {
  it("collapses whitespace and cuts at a word boundary", () => {
    expect(snippetFrom("a   b\n\nc")).toBe("a b c");
    const s = snippetFrom("lorem ipsum dolor sit amet ".repeat(20), 40);
    expect(s.length).toBeLessThanOrEqual(41);
    expect(s.endsWith("…")).toBe(true);
    expect(s).not.toMatch(/\s…$/);
  });

  it("hard cuts a long word", () => {
    expect(snippetFrom("x".repeat(300), 20)).toBe(`${"x".repeat(20)}…`);
  });
});

describe("cleanCss", () => {
  it("decodes css escapes", () => {
    expect(decodeCssEscapes("p\\6fsition:fixed")).toBe("position:fixed");
    expect(decodeCssEscapes("\\70 osition")).toBe("position");
  });

  it("keeps safe declarations and removes dangerous ones", () => {
    const r = cleanCss("color:red;position:fixed;width:expression(alert(1));margin:0", { allowRemote: false });
    expect(r.css).toContain("color:red");
    expect(r.css).toContain("margin:0");
    expect(r.css).not.toMatch(/fixed|expression/);
  });

  it("reports and neutralizes remote urls", () => {
    const blocked = cleanCss("background:url('https://a.example/x.png')", { allowRemote: false });
    expect(blocked.remoteUrls).toHaveLength(1);
    expect(blocked.css).toBe("background:none");
    const allowed = cleanCss("background:url(https://a.example/x.png)", { allowRemote: true });
    expect(allowed.css).toContain("a.example");
  });

  it("removes angle brackets and null bytes", () => {
    expect(cleanCss("a{b:c}</style><script>", { allowRemote: true }).css).not.toMatch(/[<\u0000]/);
  });
});

describe("tracker helpers", () => {
  it("parses hosts defensively", () => {
    expect(hostOf("//Cdn.Example/a")).toBe("cdn.example");
    expect(hostOf("not a url")).toBeNull();
  });

  it("matches host and path rules", () => {
    expect(matchesTrackerRule("https://mailtrack.io/x.png")).toBe(true);
    expect(matchesTrackerRule("https://sub.mailtrack.io/x.png")).toBe(true);
    expect(matchesTrackerRule("https://notmailtrack.io/x.png")).toBe(false);
    expect(matchesTrackerRule("https://u1.ct.sendgrid.net/wf/open?upn=1")).toBe(true);
    expect(matchesTrackerRule("https://u1.ct.sendgrid.net/images/logo.png")).toBe(false);
    expect(matchesTrackerRule("garbage")).toBe(false);
  });

  it("detects pixel-looking paths", () => {
    expect(looksLikePixelUrl("https://x.example/track/abc.gif")).toBe(true);
    expect(looksLikePixelUrl("https://x.example/img/logo.png")).toBe(false);
    expect(looksLikePixelUrl("bad")).toBe(false);
  });

  it("matches the receipts host with and without a scheme", () => {
    expect(isReceiptsUrl("https://r.example/i/a.gif", "r.example")).toBe(true);
    expect(isReceiptsUrl("https://x.r.example/i/a.gif", "https://r.example/base")).toBe(true);
    expect(isReceiptsUrl("https://other.example/i/a.gif", "r.example")).toBe(false);
    expect(isReceiptsUrl("https://r.example/i/a.gif", undefined)).toBe(false);
  });
});
