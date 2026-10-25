import { describe, expect, it } from "vitest";
import type { Settings, Signature } from "@flint/core";
import { defaultPatch, needsDefaultHint, pickerValue } from "./signatureDefaults";

const sig = (id: number, over: Partial<Signature> = {}): Signature => ({ id, name: `S${id}`, html: "", accountId: null, defaultNew: false, defaultReply: false, ...over });
const compose = (forNew: Record<string, number | null>, forReply: Record<string, number | null> = {}) =>
  ({ undoSendSeconds: 10, plainTextOnly: false, defaultSignatureByAccount: forNew, defaultReplySignatureByAccount: forReply }) as Settings["compose"];

describe("pickerValue", () => {
  const sigs = [sig(1), sig(2, { accountId: "a" })];
  it("shows the chosen signature, or None when None was chosen", () => {
    expect(pickerValue(sigs, compose({ a: 2 }), "a", "new")).toBe(2);
    expect(pickerValue(sigs, compose({ a: null }), "a", "new")).toBeNull();
  });
  it("shows the new-mail choice for replies until replies get their own", () => {
    expect(pickerValue(sigs, compose({ a: 2 }), "a", "reply")).toBe(2);
    expect(pickerValue(sigs, compose({ a: 2 }, { a: 1 }), "a", "reply")).toBe(1);
    expect(pickerValue(sigs, compose({ a: 2 }, { a: null }), "a", "reply")).toBeNull();
  });
  it("reads as unset with no choice and no flagged signature, and ignores a deleted choice", () => {
    expect(pickerValue(sigs, compose({}), "a", "new")).toBe("unset");
    expect(pickerValue(sigs, compose({ a: 99 }), "a", "new")).toBe("unset");
  });
  it("falls back to the flagged signature", () => {
    expect(pickerValue([sig(3, { defaultNew: true })], compose({}), "a", "new")).toBe(3);
    expect(pickerValue([sig(3, { defaultNew: true })], compose({}), "a", "reply")).toBe("unset");
  });
});

describe("defaultPatch", () => {
  it("writes only the one account in the matching map", () => {
    expect(defaultPatch("new", "a", 4)).toEqual({ compose: { defaultSignatureByAccount: { a: 4 } } });
    expect(defaultPatch("reply", "a", null)).toEqual({ compose: { defaultReplySignatureByAccount: { a: null } } });
  });
});

describe("needsDefaultHint", () => {
  it("is true only when the account can pick a signature and has none chosen", () => {
    expect(needsDefaultHint([sig(1)], compose({}), "a")).toBe(true);
    expect(needsDefaultHint([sig(1)], compose({ a: 1 }), "a")).toBe(false);
    expect(needsDefaultHint([sig(1)], compose({ a: null }), "a")).toBe(false);
    expect(needsDefaultHint([sig(1, { accountId: "b" })], compose({}), "a")).toBe(false);
    expect(needsDefaultHint([], compose({}), "a")).toBe(false);
  });
});
