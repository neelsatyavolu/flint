import { describe, expect, it } from "vitest";
import { loadFixture } from "../../fixtures";
import { CATEGORIZER_VERSION, categorize, rollupCategory } from "./index";

type Input =
  | { fn: "categorize"; from: string | null; headers: Record<string, string>; known: boolean; subject?: string }
  | { fn: "rollup"; messages: { category: "people" | "newsletters" | "notifications" | null; date: number }[] };

const fixture = loadFixture<Input, string>("categorize");

describe("categorize fixtures", () => {
  it("is versioned with the categorizer", () => expect(fixture.meta.version).toBe(CATEGORIZER_VERSION));
  it("has at least 40 corpus cases", () => expect(fixture.cases.filter((c) => c.name.startsWith("corpus: ")).length).toBeGreaterThanOrEqual(40));
  it.each(fixture.cases)("$name", ({ input, expect: want }) => {
    if (input.fn === "rollup") return expect(rollupCategory(input.messages)).toBe(want);
    const got = categorize({ from: input.from ? { name: "", address: input.from } : null, headers: input.headers, isKnownContact: input.known, subject: input.subject });
    expect(got).toBe(want);
  });
});
