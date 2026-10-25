import { simpleParser } from "mailparser";
import { describe, expect, it } from "vitest";
import { buildMime, buildReplyDraft, extractDataImages, newMessageId, prefixedSubject, type ReplySource } from "./compose";

const me = { name: "Me", address: "me@example.com" };
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("buildMime", () => {
  it("builds multipart/alternative with derived text and a Message-ID", async () => {
    const raw = await buildMime({ from: me, to: [{ name: "Ann", address: "ann@example.org" }], subject: "Héllo", html: "<p>Hi <b>Ann</b></p>", messageId: "abc@example.com" });
    const parsed = await simpleParser(raw);
    expect(parsed.messageId).toBe("<abc@example.com>");
    expect(parsed.subject).toBe("Héllo");
    expect(parsed.text).toContain("Hi ANN".replace("ANN", "Ann"));
    expect(parsed.html).toContain("<b>Ann</b>");
    expect(raw.toString()).toContain("multipart/alternative");
  });

  it("generates a Message-ID from the sender's domain", async () => {
    const parsed = await simpleParser(await buildMime({ from: me, to: [], subject: "s", html: "<p>x</p>" }));
    expect(parsed.messageId).toMatch(/^<[0-9a-f]{32}@example\.com>$/);
    expect(newMessageId("x@y.org")).toMatch(/@y\.org$/);
    expect(newMessageId("nodomain")).toMatch(/@flint\.local$/);
  });

  it("omits Bcc unless asked to keep it", async () => {
    const base = { from: me, to: [{ name: "", address: "a@example.org" }], bcc: [{ name: "", address: "secret@example.org" }], subject: "s", html: "<p>x</p>" };
    expect((await buildMime(base)).toString()).not.toMatch(/^Bcc:/im);
    expect((await buildMime({ ...base, keepBcc: true })).toString()).toMatch(/^Bcc: secret@example\.org/im);
  });

  it("sets threading headers and extra headers", async () => {
    const parsed = await simpleParser(await buildMime({
      from: me, to: [], subject: "Re: x", html: "<p>x</p>", inReplyTo: "<p1@x>", references: ["r0@x", "p1@x"], headers: { "X-Flint-Ref": "ref123" },
    }));
    expect(parsed.inReplyTo).toBe("<p1@x>");
    expect(parsed.references).toEqual(["<r0@x>", "<p1@x>"]);
    expect(parsed.headers.get("x-flint-ref")).toBe("ref123");
  });

  it("turns data: images into cid attachments", async () => {
    const raw = await buildMime({ from: me, to: [], subject: "s", html: `<p>Logo</p><img src="data:image/png;base64,${png}"><img src="data:image/png;base64,${png}">` });
    const parsed = await simpleParser(raw, { skipImageLinks: true });
    expect(parsed.html).not.toContain("data:image");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({ contentType: "image/png", contentDisposition: "inline", related: true });
    const cid = parsed.attachments[0]!.cid!;
    expect(parsed.html).toContain(`cid:${cid}`);
  });

  it("attaches files from disk and inline drafts attachments by cid", async () => {
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "flint-compose-"));
    writeFileSync(join(dir, "a.txt"), "attached text");
    writeFileSync(join(dir, "logo.png"), Buffer.from(png, "base64"));
    const raw = await buildMime({
      from: me, to: [], subject: "s", html: `<img src="cid:logo@flint">`,
      attachments: [
        { id: "1", filename: "a.txt", contentType: "text/plain", size: 13, path: join(dir, "a.txt") },
        { id: "2", filename: "logo.png", contentType: "image/png", size: 70, path: join(dir, "logo.png"), inline: true, contentId: "<logo@flint>" },
      ],
    });
    const parsed = await simpleParser(raw);
    expect(parsed.attachments.map((a) => a.filename).sort()).toEqual(["a.txt", "logo.png"]);
    expect(parsed.attachments.find((a) => a.filename === "a.txt")!.content.toString()).toBe("attached text");
    expect(parsed.attachments.find((a) => a.filename === "logo.png")!.cid).toBe("logo@flint");
  });

  it("uses explicit text when given", async () => {
    const parsed = await simpleParser(await buildMime({ from: me, to: [], subject: "s", html: "<p>html</p>", text: "custom text" }));
    expect(parsed.text?.trim()).toBe("custom text");
  });
});

describe("extractDataImages", () => {
  it("leaves html without data images alone", () => {
    const r = extractDataImages(`<img src="https://x.example/a.png">`);
    expect(r.inline).toHaveLength(0);
    expect(r.html).toContain("https://x.example/a.png");
  });
});

const source = (over: Partial<ReplySource> = {}): ReplySource => ({
  from: [{ name: "Carla", address: "carla@example.org" }],
  to: [me, { name: "Dan", address: "dan@example.org" }],
  cc: [{ name: "Eve", address: "eve@example.org" }, { name: "Me alias", address: "alias@example.com" }],
  replyTo: [], subject: "Plan", date: Date.UTC(2026, 9, 5, 22, 4), messageId: "m1@example.org", references: ["m0@example.org"],
  rawHtml: "<p>Original <b>text</b></p>", text: "Original text", ...over,
});

describe("prefixedSubject", () => {
  it("adds one prefix without stacking", () => {
    expect(prefixedSubject("Plan", "reply")).toBe("Re: Plan");
    expect(prefixedSubject("Re: Plan", "reply")).toBe("Re: Plan");
    expect(prefixedSubject("RE: Re: Plan", "replyAll")).toBe("Re: Plan");
    expect(prefixedSubject("AW: Plan", "reply")).toBe("Re: Plan");
    expect(prefixedSubject("Plan", "forward")).toBe("Fwd: Plan");
    expect(prefixedSubject("Fwd: Plan", "forward")).toBe("Fwd: Plan");
    expect(prefixedSubject("FW: FW: Plan", "forward")).toBe("Fwd: Plan");
    expect(prefixedSubject("Re: Plan", "forward")).toBe("Fwd: Re: Plan");
    expect(prefixedSubject("Fwd: Plan", "reply")).toBe("Re: Fwd: Plan");
  });
});

describe("buildReplyDraft", () => {
  const own = ["me@example.com", "ALIAS@example.com"];

  it("replies to the sender and quotes the original", () => {
    const d = buildReplyDraft(source(), "reply", own, { timeZone: "UTC" });
    expect(d.to).toEqual([{ name: "Carla", address: "carla@example.org" }]);
    expect(d.cc).toEqual([]);
    expect(d.subject).toBe("Re: Plan");
    expect(d.inReplyTo).toBe("m1@example.org");
    expect(d.references).toEqual(["m0@example.org", "m1@example.org"]);
    expect(d.quotedHtml).toContain("On Mon, Oct 5, 2026 at 10:04 PM, Carla &lt;carla@example.org&gt; wrote:");
    expect(d.quotedHtml).toContain("<blockquote");
    expect(d.quotedHtml).toContain("<b>text</b>");
  });

  it("prefers Reply-To", () => {
    const d = buildReplyDraft(source({ replyTo: [{ name: "List", address: "list@example.org" }] }), "reply", own);
    expect(d.to.map((a) => a.address)).toEqual(["list@example.org"]);
  });

  it("reply all drops the user's addresses and aliases and dedupes", () => {
    const d = buildReplyDraft(source({ cc: [{ name: "Eve", address: "eve@example.org" }, { name: "", address: "alias@example.com" }, { name: "Dan again", address: "DAN@example.org" }] }), "replyAll", own);
    expect(d.to.map((a) => a.address)).toEqual(["carla@example.org", "dan@example.org"]);
    expect(d.cc.map((a) => a.address)).toEqual(["eve@example.org"]);
  });

  it("replying to mail the user sent goes to the original recipients", () => {
    const sent = source({ from: [me], to: [{ name: "Dan", address: "dan@example.org" }], cc: [] });
    expect(buildReplyDraft(sent, "reply", own).to.map((a) => a.address)).toEqual(["dan@example.org"]);
    expect(buildReplyDraft(sent, "replyAll", own).to.map((a) => a.address)).toEqual(["dan@example.org"]);
  });

  it("falls back to the original recipients when nothing else remains", () => {
    const self = source({ from: [me], to: [me], cc: [] });
    expect(buildReplyDraft(self, "reply", own).to.map((a) => a.address)).toEqual(["me@example.com"]);
  });

  it("forward builds a header block and carries attachments over", () => {
    const att = [{ id: "1", filename: "a.pdf", contentType: "application/pdf", size: 10, path: "/tmp/a.pdf" }];
    const d = buildReplyDraft(source(), "forward", own, { forwardAttachments: att, timeZone: "UTC" });
    expect(d.to).toEqual([]);
    expect(d.subject).toBe("Fwd: Plan");
    expect(d.inReplyTo).toBeNull();
    expect(d.references).toEqual([]);
    expect(d.attachments).toEqual(att);
    expect(d.quotedHtml).toContain("---------- Forwarded message ---------");
    expect(d.quotedHtml).toContain("From: Carla &lt;carla@example.org&gt;");
    expect(d.quotedHtml).toContain("Subject: Plan");
    expect(d.quotedHtml).toContain("Cc: Eve");
  });

  it("quotes plain text safely and sanitizes html", () => {
    const text = buildReplyDraft(source({ rawHtml: null, text: "a <script>x</script>\nb" }), "reply", own);
    expect(text.quotedHtml).toContain("&lt;script&gt;");
    expect(text.quotedHtml).not.toContain("<script>");
    const html = buildReplyDraft(source({ rawHtml: `<p onclick="x()">hi</p><script>alert(1)</script><img src="https://mailtrack.io/a.png" width=1 height=1>` }), "reply", own);
    expect(html.quotedHtml).not.toMatch(/script|onclick|mailtrack/);
  });
});
