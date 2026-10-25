import { describe, expect, it } from "vitest";
import { parseSearch, parseDay } from "./parse";
import { buildMatch, buildSearchWhere, escapeLike, isEmptySearch } from "./sql";

describe("parseSearch", () => {
  it("treats bare words as terms", () => {
    const p = parseSearch("quarterly budget");
    expect(p.terms).toEqual([
      { text: "quarterly", phrase: false, negated: false },
      { text: "budget", phrase: false, negated: false },
    ]);
  });

  it("keeps quoted phrases together", () => {
    const p = parseSearch('"launch plan" notes');
    expect(p.terms[0]).toEqual({ text: "launch plan", phrase: true, negated: false });
    expect(p.terms[1]?.text).toBe("notes");
  });

  it("parses negated words and phrases", () => {
    const p = parseSearch('invoice -draft -"out of office"');
    expect(p.terms.map((t) => [t.text, t.negated])).toEqual([["invoice", false], ["draft", true], ["out of office", true]]);
  });

  it("parses from/to/cc/subject with quoted values", () => {
    const p = parseSearch('from:alice to:bob@x.com cc:"Carol D" subject:"weekly sync"');
    expect(p.from).toEqual([{ value: "alice", negated: false }]);
    expect(p.to[0]?.value).toBe("bob@x.com");
    expect(p.cc[0]?.value).toBe("Carol D");
    expect(p.subject[0]?.value).toBe("weekly sync");
    expect(p.terms).toEqual([]);
  });

  it("negates operators", () => {
    const p = parseSearch("-from:bot -has:attachment -is:unread");
    expect(p.from[0]?.negated).toBe(true);
    expect(p.hasAttachment).toBe(false);
    expect(p.unread).toBe(false);
  });

  it("parses has:, is:, in:, account:", () => {
    const p = parseSearch("has:attachment is:unread is:pinned is:snoozed in:Sent account:Me@X.com");
    expect(p.hasAttachment).toBe(true);
    expect(p.unread).toBe(true);
    expect(p.pinned).toBe(true);
    expect(p.snoozed).toBe(true);
    expect(p.in[0]?.value).toBe("sent");
    expect(p.account[0]?.value).toBe("me@x.com");
    expect(parseSearch("is:read").unread).toBe(false);
  });

  it("parses dates in local time", () => {
    const p = parseSearch("before:2026-10-01 after:2026-01-15");
    expect(p.before).toBe(new Date(2026, 9, 1).getTime());
    expect(p.after).toBe(new Date(2026, 0, 15).getTime());
  });

  it("degrades malformed input to plain text", () => {
    expect(parseSearch("before:2026-13-45").terms[0]?.text).toBe("before:2026-13-45");
    expect(parseSearch("before:2026-02-30").before).toBeNull();
    expect(parseSearch("foo:bar").terms[0]?.text).toBe("foo:bar");
    expect(parseSearch("from:").terms[0]?.text).toBe("from:");
    expect(parseSearch("is:weird").terms[0]?.text).toBe("is:weird");
    expect(parseSearch("has:cats").terms[0]?.text).toBe("has:cats");
    expect(parseSearch("-before:2026-01-01").terms).toHaveLength(1);
  });

  it("never throws on odd input", () => {
    for (const s of ['"', '""', "-", "--", ":", "::", '"unterminated phrase', "a\u0000b", "(", "AND OR NOT", "*", 'x"y"z', "-\"", " ".repeat(10), "é".repeat(1000)]) {
      expect(() => parseSearch(s)).not.toThrow();
    }
    expect(() => parseSearch(undefined as unknown as string)).not.toThrow();
    expect(parseSearch('"unterminated phrase').terms[0]).toEqual({ text: "unterminated phrase", phrase: true, negated: false });
  });

  it("parseDay validates calendar dates", () => {
    expect(parseDay("2026-02-29")).toBeNull();
    expect(parseDay("2028-02-29")).not.toBeNull();
    expect(parseDay("nope")).toBeNull();
  });
});

describe("search SQL", () => {
  it("builds a quoted match with a prefix on the last bare word", () => {
    expect(buildMatch(parseSearch("quarterly bud").terms, true)).toBe('"quarterly" "bud" *');
    expect(buildMatch(parseSearch('"launch plan"').terms, true)).toBe('"launch plan"');
    expect(buildMatch(parseSearch("a-b c@d.com").terms, false)).toBe('"a b" "c d com"');
  });

  it("neutralizes FTS syntax in user input", () => {
    const m = buildMatch(parseSearch("foo OR bar* NEAR(x) col^val").terms, true);
    expect(m).toBe('"foo" "OR" "bar" "NEAR x" "col val" *');
  });

  it("drops punctuation-only terms", () => {
    expect(buildMatch(parseSearch("!!! ???").terms, true)).toBeNull();
    expect(isEmptySearch(parseSearch("!!!"))).toBe(true);
    expect(isEmptySearch(parseSearch("from:a"))).toBe(false);
    expect(isEmptySearch(parseSearch(""))).toBe(true);
  });

  it("escapes LIKE wildcards", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    const w = buildSearchWhere(parseSearch("from:50%"), 0);
    expect(w.params).toEqual(["%50\\%%"]);
  });

  it("excludes trash and spam unless in: is given", () => {
    expect(buildSearchWhere(parseSearch("hello"), 0).excludeTrashSpam).toBe(true);
    expect(buildSearchWhere(parseSearch("hello in:trash"), 0).excludeTrashSpam).toBe(false);
    expect(buildSearchWhere(parseSearch("hello -in:trash"), 0).excludeTrashSpam).toBe(true);
  });

  it("puts negated words in a NOT IN subquery", () => {
    const w = buildSearchWhere(parseSearch("hello -world"), 0);
    expect(w.sql).toContain("NOT IN");
    expect(w.params).toEqual(['"hello" *', '"world"']);
  });

  it("covers dates, flags, folder-name and account filters", () => {
    const w = buildSearchWhere(parseSearch("before:2026-01-01 after:2025-01-01 is:snoozed is:pinned is:unread has:attachment in:Projects account:a@b.c in:archive"), 5);
    expect(w.sql).toContain("m.date < ?");
    expect(w.sql).toContain("m.date >= ?");
    expect(w.sql).toContain("t.snoozed_until > ?");
    expect(w.sql).toContain("lower(xr.name) = ?");
    expect(w.params).toContain("projects");
    expect(w.params).toContain("a@b.c");
  });
});
