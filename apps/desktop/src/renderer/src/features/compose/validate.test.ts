import { describe, expect, it } from "vitest";
import { checkSend, mentionsAttachment } from "./validate";

const who = { name: "", address: "a@b.co" };
const file = { id: 1, filename: "plan.pdf" };
describe("checkSend", () => {
  it("blocks without recipients before checking the subject", () => {
    expect(checkSend({ to: [], cc: [], bcc: [], subject: "" })).toBe("no_recipients");
  });
  it("asks about an empty subject", () => {
    expect(checkSend({ to: [who], cc: [], bcc: [], subject: "   " })).toBe("no_subject");
  });
  it("accepts bcc-only recipients", () => {
    expect(checkSend({ to: [], cc: [], bcc: [who], subject: "Hi" })).toBe("ok");
  });
  it("asks when the body mentions an attachment and none is attached", () => {
    expect(checkSend({ to: [who], cc: [], bcc: [], subject: "Hi", html: "<p>See attached.</p>", attachments: [] })).toBe("no_attachment");
  });
  it("lets the mention through once something is attached", () => {
    expect(checkSend({ to: [who], cc: [], bcc: [], subject: "Hi", html: "<p>See attached.</p>", attachments: [file] })).toBe("ok");
  });
  it("asks about the subject first, then the attachment once the subject is confirmed", () => {
    const draft = { to: [who], cc: [], bcc: [], subject: "", html: "<p>The report is enclosed</p>", attachments: [] };
    expect(checkSend(draft)).toBe("no_subject");
    expect(checkSend(draft, ["no_subject"])).toBe("no_attachment");
    expect(checkSend(draft, ["no_subject", "no_attachment"])).toBe("ok");
  });
});

describe("mentionsAttachment", () => {
  it("matches the attach words and enclosed, case-insensitively", () => {
    for (const text of ["I've attached it", "Attachment below", "attaching the file", "ATTACHED", "Please find enclosed"]) {
      expect(mentionsAttachment(`<p>${text}</p>`)).toBe(true);
    }
  });
  it("matches the plural, the bare verb with an object, and enclosing", () => {
    for (const text of ["Please find the attachments", "I will attach it", "I'll attach the deck", "She attaches a copy", "enclosing the form"]) {
      expect(mentionsAttachment(`<p>${text}</p>`)).toBe(true);
    }
  });
  it("ignores words that only contain the stem", () => {
    expect(mentionsAttachment("<p>I'm attachedness-free and unattached</p>")).toBe(false);
    expect(mentionsAttachment("<p>We should attach no meaning to it</p>")).toBe(false);
  });
  it("ignores the signature and quoted mail", () => {
    expect(mentionsAttachment('<p>Thanks!</p><div class="flint_signature">Attachments may be confidential.</div>')).toBe(false);
    expect(mentionsAttachment('<p>Thanks!</p><div class="flint-signature">See attached policy.</div>')).toBe(false);
    expect(mentionsAttachment('<p>Got it.</p><div class="flint_quote"><blockquote>I attached the deck.</blockquote></div>')).toBe(false);
    expect(mentionsAttachment("<p>Got it.</p><blockquote>attached</blockquote>")).toBe(false);
  });
});
