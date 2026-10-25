import { describe, expect, it } from "vitest";
import { splitQuoted, splitQuotedHtml } from "./quotedText";
import { scrollTargetTop } from "./scrollTarget";

const text = (html: string | null) => (html ? new DOMParser().parseFromString(html, "text/html").body.textContent?.replace(/\s+/g, " ").trim() : null);

describe("splitQuotedHtml", () => {
  it("keeps a Gmail forwarded message expanded", () => {
    const html = `<body><div>FYI</div><div class="gmail_quote"><div>---------- Forwarded message ---------<br>From: <b>Carla</b><br>Date: Mon, Oct 5<br>Subject: Plans</div><div>The actual plans</div></div></body>`;
    const r = splitQuotedHtml(html);
    expect(r.quoted).toBeNull();
    expect(text(r.body)).toContain("The actual plans");
  });
  it("does not hide anything in a message whose subject is a forward", () => {
    const html = `<body><p>FYI</p><blockquote type="cite"><p>Original</p></blockquote></body>`;
    expect(splitQuotedHtml(html, "Fwd: Plans").quoted).toBeNull();
    expect(splitQuotedHtml(html, "Re: Plans").quoted).not.toBeNull();
  });
  it("collapses a Gmail quote", () => {
    const html = `<html><head><style>p{color:red}</style></head><body><div>Sounds good.</div><div class="gmail_quote"><div class="gmail_attr">On Mon, Carla wrote:</div><blockquote class="gmail_quote">Can we meet?</blockquote></div></body></html>`;
    const r = splitQuotedHtml(html);
    expect(text(r.body)).toBe("Sounds good.");
    expect(text(r.quoted)).toContain("Can we meet?");
    expect(r.body).toContain("color:red");
    expect(r.quoted).toContain("color:red");
  });
  it("collapses an Apple Mail cite block together with its attribution line", () => {
    const html = `<body><div>Yes, Thursday.</div><div>On Oct 5, 2026, at 9:00 AM, Carla Mendes wrote:</div><blockquote type="cite"><div>Thursday?</div></blockquote></body>`;
    const r = splitQuotedHtml(html);
    expect(text(r.body)).toBe("Yes, Thursday.");
    expect(text(r.quoted)).toContain("wrote:");
    expect(text(r.quoted)).toContain("Thursday?");
  });
  it("collapses an Outlook From/Sent header and what follows", () => {
    const html = `<body><p>Thanks!</p><hr><p><b>From:</b> Carla Mendes<br><b>Sent:</b> Monday, October 5, 2026 9:00 AM<br><b>To:</b> Alex</p><p>Original text</p></body>`;
    const r = splitQuotedHtml(html);
    expect(text(r.body)).toBe("Thanks!");
    expect(r.body).not.toContain("<hr");
    expect(text(r.quoted)).toContain("Original text");
  });
  it("collapses a bare 'On ... wrote:' line and the siblings after it", () => {
    const html = `<body><div>Reply</div><div>On Mon, Oct 5, 2026, Carla wrote:</div><div>old one</div><div>old two</div></body>`;
    const r = splitQuotedHtml(html);
    expect(text(r.body)).toBe("Reply");
    expect(text(r.quoted)).toBe("On Mon, Oct 5, 2026, Carla wrote:old oneold two");
  });
  it("keeps a message whole when nothing is quoted or the message is only a quote", () => {
    expect(splitQuotedHtml("<body><p>Hello</p></body>").quoted).toBeNull();
    const only = `<body><blockquote type="cite">All quote</blockquote></body>`;
    expect(splitQuotedHtml(only)).toEqual({ body: only, quoted: null });
  });
});

describe("splitQuoted (plain text, Outlook)", () => {
  it("splits at an Outlook header block and at Original Message lines", () => {
    const t = "Thanks!\n\nFrom: Carla <c@x.com>\nSent: Monday, October 5, 2026 9:00 AM\nTo: Alex\nSubject: Hi\n\nOld text";
    expect(splitQuoted(t).body).toBe("Thanks!");
    expect(splitQuoted(t).quoted.startsWith("From: Carla")).toBe(true);
    expect(splitQuoted("Ok\n-----Original Message-----\nOld").quoted).toContain("Original Message");
  });
  it("does not split a lone From: line", () => {
    expect(splitQuoted("Hi\nFrom: the team, with love").quoted).toBe("");
  });
});

describe("scrollTargetTop", () => {
  it("bottom-aligns a card that fits, leaving the clearance below", () => {
    expect(scrollTargetTop({ cardTop: 1000, cardHeight: 300, viewport: 700, clearance: 72 })).toBe(672);
  });
  it("top-aligns a card taller than the viewport", () => {
    expect(scrollTargetTop({ cardTop: 1000, cardHeight: 900, viewport: 700, clearance: 72 })).toBe(984);
  });
  it("never goes negative", () => {
    expect(scrollTargetTop({ cardTop: 20, cardHeight: 100, viewport: 700, clearance: 72 })).toBe(0);
  });
});
