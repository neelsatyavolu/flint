import { describe, expect, it } from "vitest";
import { defaultSignature, hasSignature, replaceSignature, signatureBlock } from "../src/service/compose-signature";
import { DEFAULT_SETTINGS } from "../src/store";
import type { Signature } from "../src/types";

const sig = (over: Partial<Signature> = {}): Signature => ({ id: 1, name: "Work", html: "<div>Alice</div><p>Acme</p>", accountId: null, defaultNew: false, defaultReply: false, ...over });

describe("signature block", () => {
  it("appends, swaps in place and removes, even when the signature holds nested divs", () => {
    const withFirst = replaceSignature("<p>Hi</p>", sig());
    expect(hasSignature(withFirst)).toBe(true);
    expect(withFirst).toContain(signatureBlock(sig()));
    const swapped = replaceSignature(`${withFirst}<p>after</p>`, sig({ id: 2, html: "<b>Bob</b>" }));
    expect(swapped).toBe(`<p>Hi</p><br>${signatureBlock(sig({ id: 2, html: "<b>Bob</b>" }))}<p>after</p>`);
    expect(replaceSignature(swapped, null)).toBe("<p>Hi</p><p>after</p>");
    expect(replaceSignature("<p>Hi</p>", null)).toBe("<p>Hi</p>");
  });
});

describe("defaultSignature", () => {
  const all = [sig({ id: 1, defaultNew: true }), sig({ id: 2, accountId: "a", defaultNew: true, defaultReply: true }), sig({ id: 3, defaultReply: true })];
  const source = { getSignature: (id: number) => all.find((s) => s.id === id) ?? null, listSignatures: () => all };
  const settings = (map: Record<string, number | null>) => ({ ...DEFAULT_SETTINGS, compose: { ...DEFAULT_SETTINGS.compose, defaultSignatureByAccount: map } });

  it("prefers the account's flagged signature, then a shared one", () => {
    expect(defaultSignature(source, settings({}), "a", "new")?.id).toBe(2);
    expect(defaultSignature(source, settings({}), "b", "new")?.id).toBe(1);
    expect(defaultSignature(source, settings({}), "b", "reply")?.id).toBe(3);
    expect(defaultSignature(source, settings({}), "b", "forward")?.id).toBe(1);
  });

  it("lets settings choose a signature or none for an account", () => {
    expect(defaultSignature(source, settings({ a: 3 }), "a", "new")?.id).toBe(3);
    expect(defaultSignature(source, settings({ a: null }), "a", "new")).toBeNull();
    expect(defaultSignature(source, settings({ a: 99 }), "a", "new")?.id).toBe(2);
  });
});
