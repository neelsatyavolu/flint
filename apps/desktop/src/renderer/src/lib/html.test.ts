import { describe, expect, it, vi } from "vitest";
import { MAIL_FRAME_SANDBOX, buildCsp, buildSrcdoc, interceptLinks, observeFrameHeight, textToHtml } from "./html";

describe("buildCsp", () => {
  it("blocks remote images by default", () => {
    const csp = buildCsp(false);
    expect(csp).toContain("img-src data: flint-attachment:;");
    expect(csp).not.toContain("https:");
    expect(csp).toContain("default-src 'none'");
  });
  it("allows https images when asked", () => expect(buildCsp(true)).toContain("img-src data: flint-attachment: https:"));
});

describe("buildSrcdoc", () => {
  it("embeds CSP, base target, body and the white sheet by default", () => {
    const doc = buildSrcdoc({ html: "<p>Hello</p>", allowRemoteImages: false });
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain('<base target="_blank">');
    expect(doc).toContain("<p>Hello</p>");
    expect(doc).toContain("#ffffff");
  });
  it("applies custom colors and padding", () => {
    const doc = buildSrcdoc({ html: "x", allowRemoteImages: true, colors: { bg: "#111110", fg: "#edebe5", link: "#4c8dff" }, padding: 0 });
    expect(doc).toContain("background:#111110");
    expect(doc).toContain("padding:0px");
  });
  it("never allows scripts in the sandbox", () => {
    expect(MAIL_FRAME_SANDBOX).not.toContain("allow-scripts");
    expect(MAIL_FRAME_SANDBOX).toContain("allow-same-origin");
  });
});

describe("textToHtml", () => {
  it("escapes markup", () => expect(textToHtml("a <b> & c")).toContain("a &lt;b&gt; &amp; c"));
});

function frameWith(html: string): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  frame.contentDocument!.open();
  frame.contentDocument!.write(html);
  frame.contentDocument!.close();
  return frame;
}

describe("interceptLinks", () => {
  it("routes http and mailto clicks and swallows others", () => {
    const frame = frameWith('<a id="a" href="https://example.com/x">x</a><a id="b" href="javascript:alert(1)">y</a><a id="c" href="mailto:a@b.c">z</a>');
    const open = vi.fn();
    const off = interceptLinks(frame, open);
    const doc = frame.contentDocument!;
    for (const id of ["a", "b", "c"]) doc.getElementById(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(open.mock.calls).toEqual([["https://example.com/x"], ["mailto:a@b.c"]]);
    off();
    doc.getElementById("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(open).toHaveBeenCalledTimes(2);
    frame.remove();
  });
});

describe("observeFrameHeight", () => {
  it("reports the document height once ready and on load", () => {
    const frame = frameWith("<p>hi</p>");
    const doc = frame.contentDocument!;
    Object.defineProperty(doc.documentElement, "scrollHeight", { configurable: true, value: 240 });
    const heights: number[] = [];
    const stop = observeFrameHeight(frame, (h) => heights.push(h));
    expect(heights).toEqual([240]);
    Object.defineProperty(doc.documentElement, "scrollHeight", { configurable: true, value: 300 });
    frame.dispatchEvent(new Event("load"));
    expect(heights).toEqual([240, 300]);
    frame.dispatchEvent(new Event("load")); // unchanged: no duplicate report
    expect(heights).toEqual([240, 300]);
    stop();
    frame.remove();
  });
});
