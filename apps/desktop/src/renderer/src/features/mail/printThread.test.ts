import { describe, expect, it, vi } from "vitest";
import type { MessageView, ThreadDetail } from "@flint/core";
import { buildPrintDocument, withBodies, type PrintMessage } from "./printThread";

const addr = (name: string, address: string) => ({ name, address });
const message = (over: Partial<PrintMessage> = {}): PrintMessage => ({
  from: [addr("Carla Mendes", "carla@school.org")],
  to: [addr("Alex", "alex@me.dev")],
  cc: [],
  date: Date.UTC(2026, 9, 23, 20, 43),
  html: null,
  text: "Hello there",
  remoteImages: "allowed",
  ...over,
});

describe("buildPrintDocument", () => {
  it("puts the subject first, then each message's people, date and body", () => {
    const doc = buildPrintDocument("Field trip", [message(), message({ from: [addr("", "r@x.com")], cc: [addr("Priya", "p@x.com")], text: "Second" })]);
    expect(doc).toContain("<title>Field trip</title>");
    expect(doc).toContain("<h1>Field trip</h1>");
    expect(doc).toContain("2 messages");
    expect(doc).toContain("Carla Mendes &lt;carla@school.org&gt;");
    expect(doc).toContain("<b>Cc</b> Priya &lt;p@x.com&gt;");
    expect(doc).toContain("Oct 23, 2026");
    expect(doc.indexOf("Hello there")).toBeLessThan(doc.indexOf("Second"));
    expect(doc.match(/class="msg"/g)).toHaveLength(2);
  });

  it("escapes the subject and plain-text bodies", () => {
    const doc = buildPrintDocument("<script>x</script>", [message({ text: "a < b & <b>c</b>" })]);
    expect(doc).not.toContain("<script>x</script>");
    expect(doc).toContain("a &lt; b &amp; &lt;b&gt;c&lt;/b&gt;");
  });

  it("uses a light sheet and a CSP that blocks scripts", () => {
    const doc = buildPrintDocument("S", [message()]);
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("background:#fff");
  });

  it("keeps blocked remote images blocked", () => {
    const html = '<p>Hi</p><img src="https://track.test/a.png">';
    expect(buildPrintDocument("S", [message({ html, remoteImages: "blocked" })])).not.toContain("https://track.test/a.png");
    expect(buildPrintDocument("S", [message({ html, remoteImages: "allowed" })])).toContain("https://track.test/a.png");
  });

  it("names a missing subject", () => {
    expect(buildPrintDocument("", [message()])).toContain("<h1>(no subject)</h1>");
  });
});

describe("withBodies", () => {
  it("loads only the messages whose body the reader has not fetched", async () => {
    const loaded = { id: 1, html: "<p>a</p>", text: null, bodyLoaded: true } as MessageView;
    const missing = { id: 2, html: null, text: null, bodyLoaded: false } as MessageView;
    const full = { ...missing, html: "<p>b</p>", bodyLoaded: true } as MessageView;
    const load = vi.fn(async () => full);
    const out = await withBodies({ messages: [loaded, missing] } as ThreadDetail, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(2);
    expect(out).toEqual([loaded, full]);
  });
});
