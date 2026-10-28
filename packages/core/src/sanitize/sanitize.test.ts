import { describe, expect, it } from "vitest";
import { loadFixture } from "../../fixtures";
import { PLACEHOLDER_GIF, sanitizeForDisplay, type SanitizeOptions } from "./index";

type Rx = { p: string; f: string };
type Expect = {
  inert?: boolean; contains?: string[]; notContains?: string[]; matches?: Rx[]; notMatches?: Rx[];
  hasRemoteImages?: boolean; hasTrackers?: boolean; startsWith?: string; idempotent?: boolean; maxMs?: number;
};
type Opts = { allowRemoteImages: boolean; receiptsHost?: string; blockTrackers?: boolean; cids?: Record<string, string> };
type Input = {
  fn: string; html?: string; htmlRepeat?: { before: string; unit: string; count: number; after: string };
  options: Opts; runs?: Opts[];
};
type Meta = { placeholderGif: string; inert: { name: string; regex: string; flags: string; applyTo: "lower" | "lowerValuesBlanked" }[] };

const fixture = loadFixture<Input, Expect, Meta>("sanitize");
const RECEIPTS_HOST = "receipts.flint.example";

const clean = (html: string, o: Opts) => {
  const { cids, ...rest } = o;
  const options: SanitizeOptions = { receiptsHost: RECEIPTS_HOST, ...rest, ...(cids ? { cidResolver: (cid: string) => cids[cid] ?? null } : {}) };
  return sanitizeForDisplay(html, options);
};
const token = (s: string): string => s.replace("{{PLACEHOLDER_GIF}}", PLACEHOLDER_GIF);

/** Output must never contain anything a browser would execute or fetch behind the user's back. */
function assertInert(html: string): void {
  const lower = html.toLowerCase();
  for (const c of fixture.meta.inert) {
    const text = c.applyTo === "lowerValuesBlanked" ? lower.replace(/="[^"]*"|='[^']*'/g, '=""') : lower;
    expect(new RegExp(c.regex, c.flags).test(text), c.name).toBe(false);
  }
}

describe("sanitize fixtures", () => {
  it("pins the placeholder image", () => expect(fixture.meta.placeholderGif).toBe(PLACEHOLDER_GIF));

  it.each(fixture.cases.filter((c) => c.input.fn === "sanitize"))("$name", ({ input, expect: want }) => {
    const html = input.html ?? `${input.htmlRepeat!.before}${input.htmlRepeat!.unit.repeat(input.htmlRepeat!.count)}${input.htmlRepeat!.after}`;
    for (const opts of input.runs ?? [input.options]) {
      const started = Date.now();
      const r = clean(html, opts);
      if (want.maxMs !== undefined) expect(Date.now() - started).toBeLessThan(want.maxMs);
      if (want.inert) assertInert(r.html);
      for (const s of want.contains ?? []) expect(r.html).toContain(token(s));
      for (const s of want.notContains ?? []) expect(r.html).not.toContain(token(s));
      for (const m of want.matches ?? []) expect(new RegExp(m.p, m.f).test(r.html)).toBe(true);
      for (const m of want.notMatches ?? []) expect(new RegExp(m.p, m.f).test(r.html)).toBe(false);
      if (want.hasRemoteImages !== undefined) expect(r.hasRemoteImages).toBe(want.hasRemoteImages);
      if (want.hasTrackers !== undefined) expect(r.hasTrackers).toBe(want.hasTrackers);
      if (want.startsWith) expect(r.html.startsWith(want.startsWith)).toBe(true);
      if (want.idempotent) expect(clean(r.html, opts).html).toBe(r.html);
    }
  });
});
