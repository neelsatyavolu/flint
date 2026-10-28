import { describe, expect, it } from "vitest";
import { dayString, loadFixture } from "../../fixtures";
import { buildGmailRaw, buildImapCriteria, inTargets } from "./server";
import { parseSearch } from "./parse";

type Input = { fn: string; query: string };
const fixture = loadFixture<Input, any>("search");
const FNS = new Set(["buildGmailRaw", "buildImapCriteria", "inTargets"]);

describe("search server fixtures", () => {
  it.each(fixture.cases.filter((c) => FNS.has(c.input.fn)))("$name", ({ input, expect: want }) => {
    const p = parseSearch(input.query);
    if (input.fn === "buildGmailRaw") return expect(buildGmailRaw(p)).toBe(want);
    if (input.fn === "inTargets") return expect(inTargets(p)).toEqual(want);
    const c = buildImapCriteria(p);
    expect(c && Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v instanceof Date ? dayString(v.getTime()) : v]))).toEqual(want);
  });
});
