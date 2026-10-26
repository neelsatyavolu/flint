import { describe, expect, it } from "vitest";
import type { Signature } from "@flint/core";
import { defaultSignatureFor, isBodyEmpty, signaturesForAccount, swapSignatureHtml } from "./signature";

const sig = (id: number, o: Partial<Signature> = {}): Signature => ({ id, name: `S${id}`, html: `<b>sig${id}</b>`, accountIds: [], defaultNew: true, defaultReply: false, ...o });

describe("defaultSignatureFor", () => {
  const sigs = [sig(1, { accountIds: ["a"] }), sig(2, { defaultNew: false, defaultReply: true })];
  const forNew = (m: Record<string, number | null>, r: Record<string, number | null> = {}) => ({ defaultSignatureByAccount: m, defaultReplySignatureByAccount: r });
  it("uses the settings choice even when the signature carries no default flag", () => {
    expect(defaultSignatureFor(sigs, "a", "new", forNew({ a: 2 }))?.id).toBe(2);
    expect(defaultSignatureFor(sigs, "a", "forward", forNew({ a: 2 }))?.id).toBe(2);
  });
  it("reads replies from their own map, then from the new-mail choice", () => {
    expect(defaultSignatureFor(sigs, "a", "reply", forNew({ a: 1 }, { a: 2 }))?.id).toBe(2);
    expect(defaultSignatureFor(sigs, "a", "replyAll", forNew({ a: 1 }))?.id).toBe(1);
    expect(defaultSignatureFor(sigs, "a", "reply", forNew({ a: 1 }, { a: null }))).toBeNull();
    expect(defaultSignatureFor(sigs, "a", "new", forNew({ a: 1 }, { a: null }))?.id).toBe(1);
  });
  it("treats null as an explicit none", () => {
    expect(defaultSignatureFor(sigs, "a", "new", forNew({ a: null }))).toBeNull();
  });
  it("falls back to the flagged signature when there is no choice or it points at a deleted one", () => {
    expect(defaultSignatureFor(sigs, "a", "new", forNew({}))?.id).toBe(1);
    expect(defaultSignatureFor(sigs, "a", "new", forNew({ a: 99 }))?.id).toBe(1);
    expect(defaultSignatureFor(sigs, "b", "reply", forNew({}))?.id).toBe(2);
    expect(defaultSignatureFor([sig(3, { defaultNew: false })], "a", "new", forNew({}))).toBeNull();
  });
  it("lists shared and account-specific signatures", () => {
    const list = signaturesForAccount([sig(1), sig(2, { accountIds: ["a"] }), sig(3, { accountIds: ["b"] })], "a");
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

describe("core signature class", () => {
  it("recognises and writes the class core uses", () => {
    const core = '<p>Hi</p><div class="flint_signature" data-signature-id="1"><b>old</b></div>';
    expect(isBodyEmpty('<p></p><div class="flint_signature"><b>x</b></div>')).toBe(true);
    const out = swapSignatureHtml(core, { id: 2, name: "n", html: "<i>new</i>", accountIds: [], defaultNew: true, defaultReply: true });
    expect(out).toContain('class="flint_signature"');
    expect(out).not.toContain("old");
    expect(out.match(/flint_signature/g)).toHaveLength(1);
  });
});

describe("signatures shared by several accounts", () => {
  const shared = sig(5, { accountIds: ["a", "b"], defaultNew: true });
  const all = sig(6, { defaultNew: true });
  it("is offered for each listed account only (plus all-accounts ones)", () => {
    expect(signaturesForAccount([shared, all], "a").map((s) => s.id)).toEqual([5, 6]);
    expect(signaturesForAccount([shared, all], "b").map((s) => s.id)).toEqual([5, 6]);
    expect(signaturesForAccount([shared, all], "c").map((s) => s.id)).toEqual([6]);
  });
  it("is the flagged default for each listed account, before an all-accounts one", () => {
    const empty = { defaultSignatureByAccount: {}, defaultReplySignatureByAccount: {} };
    expect(defaultSignatureFor([all, shared], "b", "new", empty)?.id).toBe(5);
    expect(defaultSignatureFor([all, shared], "c", "new", empty)?.id).toBe(6);
  });
});
