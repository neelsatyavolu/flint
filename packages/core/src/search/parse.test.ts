import { describe, expect, it } from "vitest";
import { dayString, loadFixture } from "../../fixtures";
import { parseDay, parseSearch } from "./parse";
import { buildMatch, buildSearchWhere, escapeLike, isEmptySearch } from "./sql";

type Input = { fn: string; query?: string; repeat?: { unit: string; count: number }; value?: string; prefixLast?: boolean; now?: number };
const fixture = loadFixture<Input, any>("search");
const FNS = new Set(["parseSearch", "parseDay", "buildMatch", "isEmptySearch", "escapeLike", "searchWhere"]);

const queryOf = (i: Input): string => i.query ?? i.repeat!.unit.repeat(i.repeat!.count);

describe("search fixtures", () => {
  it.each(fixture.cases.filter((c) => FNS.has(c.input.fn)))("$name", ({ input, expect: want }) => {
    switch (input.fn) {
      case "parseSearch": { const p = parseSearch(queryOf(input)); return expect({ ...p, before: dayString(p.before), after: dayString(p.after) }).toEqual(want); }
      case "parseDay": return expect(dayString(parseDay(input.value!))).toBe(want);
      case "buildMatch": return expect(buildMatch(parseSearch(input.query!).terms, input.prefixLast!)).toBe(want);
      case "isEmptySearch": return expect(isEmptySearch(parseSearch(input.query!))).toBe(want);
      case "escapeLike": return expect(escapeLike(input.value!)).toBe(want);
      case "searchWhere": { const w = buildSearchWhere(parseSearch(input.query!), input.now!); return expect({ sql: w.sql, params: w.params, excludeTrashSpam: w.excludeTrashSpam }).toEqual(want); }
    }
  });

  it("never throws on non-string input", () => {
    expect(() => parseSearch(undefined as unknown as string)).not.toThrow();
  });
});
