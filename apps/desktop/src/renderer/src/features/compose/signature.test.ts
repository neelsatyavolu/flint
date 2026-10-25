import { describe, expect, it } from "vitest";
import type { Signature } from "@flint/core";
import { defaultSignatureFor, isBodyEmpty, signaturesForAccount, swapSignatureHtml } from "./signature";

const sig = (id: number, o: Partial<Signature> = {}): Signature => ({ id, name: `S${id}`, html: `<b>sig${id}</b>`, accountId: null, defaultNew: true, defaultReply: false, ...o });

describe("defaultSignatureFor", () => {
  const sigs = [sig(1), sig(2, { defaultNew: false, defaultReply: true })];
  it("respects the per-account default and the new/reply flags", () => {
    expect(defaultSignatureFor(sigs, "a", "new", { a: 1 })?.id).toBe(1);
    expect(defaultSignatureFor(sigs, "a", "reply", { a: 1 })).toBeNull();
    expect(defaultSignatureFor(sigs, "a", "reply", { a: 2 })?.id).toBe(2);
    expect(defaultSignatureFor(sigs, "b", "new", { a: 1 })).toBeNull();
    expect(defaultSignatureFor(sigs, "a", "new", { a: null })).toBeNull();
  });
  it("lists shared and account-specific signatures", () => {
    const list = signaturesForAccount([sig(1), sig(2, { accountId: "a" }), sig(3, { accountId: "b" })], "a");
    expect(list.map((s) => s.id)).toEqual([1, 2]);
  });
});

describe("swapSignatureHtml", () => {
  const body = '<p>Hi</p><div class="flint-signature" data-signature-id="1"><b>sig1</b></div>';
  it("replaces the block and keeps the body", () => {
    const out = swapSignatureHtml(body, sig(2));
    expect(out).toContain("<p>Hi</p>");
    expect(out).toContain('data-signature-id="2"');
    expect(out).toContain("sig2");
    expect(out).not.toContain("sig1");
  });
  it("removes the block with null and adds one when missing", () => {
    expect(swapSignatureHtml(body, null)).toBe("<p>Hi</p>");
    expect(swapSignatureHtml("<p>Hi</p>", sig(3))).toContain("sig3");
  });
});

describe("isBodyEmpty", () => {
  it("ignores signature and blank paragraphs", () => {
    expect(isBodyEmpty('<p></p><div class="flint-signature"><b>x</b></div>')).toBe(true);
    expect(isBodyEmpty('<p>hi</p><div class="flint-signature"></div>')).toBe(false);
    expect(isBodyEmpty('<p><img src="x"></p>')).toBe(false);
  });
});
