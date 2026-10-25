import { describe, expect, it } from "vitest";
import { makeStyle } from "./style";
import { clip, renderTable } from "./table";
import { htmlToReadable, messageBody, textToHtml, formatAddress } from "./text";

describe("renderTable", () => {
  const style = makeStyle(false);
  it("aligns columns and truncates the last one", () => {
    const t = renderTable(["ID", "SUBJECT"], [["1", "Hello"], ["100", "x".repeat(200)]], { width: 40, style });
    const lines = t.split("\n");
    expect(lines[0]).toBe("ID   SUBJECT");
    expect(lines[1]).toBe("1    Hello");
    expect(lines[2]?.length).toBeLessThanOrEqual(40);
    expect(lines[2]?.endsWith("…")).toBe(true);
  });
  it("uses ANSI only with a style that has it", () => {
    const tty = makeStyle(true);
    expect(renderTable(["A"], [["b"]], { width: 40, style: tty, bold: () => true })).toContain("\x1b[");
    expect(renderTable(["A"], [["b"]], { width: 40, style })).not.toContain("\x1b[");
  });
  it("cleans newlines and clips", () => {
    expect(clip("a\nb", 10)).toBe("a b");
    expect(clip("abcdef", 4)).toBe("abc…");
  });
});

describe("text", () => {
  it("converts html", () => {
    const t = htmlToReadable('<p>Hi <b>there</b></p><p><a href="https://x.co">link</a><img src="a.png"></p>');
    expect(t).toContain("Hi there");
    expect(t).toContain("link [https://x.co]");
  });
  it("picks the body", () => {
    const m = { text: null, html: "<p>Hello</p>", snippet: "snip", bodyLoaded: true } as never;
    expect(messageBody(m, false)).toBe("Hello");
    expect(messageBody(m, true)).toBe("<p>Hello</p>");
    expect(messageBody({ text: "plain", html: "<p>x</p>" } as never, false)).toBe("plain");
    expect(messageBody({ text: null, html: null, snippet: "snip", bodyLoaded: false } as never, false)).toBe("snip");
  });
  it("builds html and addresses", () => {
    expect(textToHtml("a < b\nc\n\nd")).toBe("<p>a &lt; b<br>c</p><p>d</p>");
    expect(formatAddress({ name: "Cindy", address: "c@x.co" })).toBe("Cindy <c@x.co>");
    expect(formatAddress({ name: "", address: "c@x.co" })).toBe("c@x.co");
  });
});
