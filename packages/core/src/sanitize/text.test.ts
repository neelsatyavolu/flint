import { describe, expect, it } from "vitest";
import { loadFixture, refreshData } from "../../fixtures";
import { cleanCss, decodeCssEscapes } from "./css";
import { htmlToText, snippetFrom } from "./htmlToText";
import { TRACKER_RULES, hostOf, isReceiptsUrl, looksLikePixelUrl, matchesTrackerRule } from "./trackers";

type TextExpect = { equals?: string; contains?: string[]; notContains?: string[]; noTripleNewline?: boolean; maxLineLength?: number };
const sanitizeFixture = loadFixture<Record<string, any>, any>("sanitize");

const rulesNow = TRACKER_RULES.map((r) => (r.path ? { host: r.host, path: { source: r.path.source, flags: r.path.flags } } : { host: r.host }));
refreshData("trackers", "rules", rulesNow); // FLINT_FIXTURES_UPDATE=1 rewrites the stored table before it is read below.
const trackers = loadFixture<Record<string, any>, any>("trackers");

describe("text helpers fixtures", () => {
  it.each(sanitizeFixture.cases.filter((c) => c.input.fn === "htmlToText"))("$name", ({ input, expect: want }) => {
    const t = htmlToText(input.html, input.wordwrap ? { wordwrap: input.wordwrap } : {});
    const w = want as TextExpect;
    if (w.equals !== undefined) expect(t).toBe(w.equals);
    for (const s of w.contains ?? []) expect(t).toContain(s);
    for (const s of w.notContains ?? []) expect(t).not.toContain(s);
    if (w.noTripleNewline) expect(t).not.toMatch(/\n{3,}/);
    if (w.maxLineLength) expect(Math.max(...t.split("\n").map((l) => l.length))).toBeLessThanOrEqual(w.maxLineLength);
  });

  it.each(sanitizeFixture.cases.filter((c) => c.input.fn === "snippetFrom"))("$name", ({ input, expect: want }) => {
    expect(snippetFrom(input.text, input.max)).toBe(want.equals);
  });

  it.each(sanitizeFixture.cases.filter((c) => c.input.fn === "decodeCssEscapes"))("$name", ({ input, expect: want }) => {
    expect(decodeCssEscapes(input.css)).toBe(want);
  });

  it.each(sanitizeFixture.cases.filter((c) => c.input.fn === "cleanCss"))("$name", ({ input, expect: want }) => {
    expect(cleanCss(input.css, { allowRemote: input.allowRemote })).toEqual(want);
  });
});

describe("tracker fixtures", () => {
  it("rules table matches TRACKER_RULES", () => expect(trackers.rules).toEqual(rulesNow));

  it.each(trackers.cases)("$name", ({ input, expect: want }) => {
    switch (input.fn) {
      case "hostOf": return expect(hostOf(input.url)).toBe(want);
      case "matchesTrackerRule": return expect(matchesTrackerRule(input.url)).toBe(want);
      case "looksLikePixelUrl": return expect(looksLikePixelUrl(input.url)).toBe(want);
      case "isReceiptsUrl": return expect(isReceiptsUrl(input.url, input.receiptsHost ?? undefined)).toBe(want);
    }
  });
});
