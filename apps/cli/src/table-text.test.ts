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
    expect(t).toContain("[link](https://x.co)");
  });
  it("shortens tracking urls, keeps short ones, and prints bare urls once", () => {
    const long = `https://click.example.com/track/${"a1b2".repeat(30)}?u=1`;
    const t = htmlToReadable(`<p>Open <a href="${long}">your invoice</a> or <a href="https://x.co/a">https://x.co/a</a>, mail <a href="mailto:a@b.co">Ann</a></p>`);
    expect(t).toContain("[your invoice](https://click.example.com/...)");
    expect(t).not.toContain("a1b2a1b2");
    expect(t).toContain("https://x.co/a");
    expect(t.match(/x\.co\/a/g)).toHaveLength(1);
    expect(t).toContain("[Ann](a@b.co)");
  });
  it("keeps headings, lists and tables readable", () => {
    const t = htmlToReadable("<h1>Order</h1><ul><li>One</li><li>Two</li></ul><table><tr><th>Item</th><th>Price</th></tr><tr><td>Tea</td><td>$4</td></tr></table>");
    expect(t).toContain("Order");
    expect(t).not.toContain("ORDER");
    expect(t).toMatch(/\* One\n\s*\* Two/);
    expect(t).toMatch(/Item\s+Price/);
    expect(t).toMatch(/Tea\s+\$4/);
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
