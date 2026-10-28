import { describe, expect, it } from "vitest";
import { loadFixture } from "../../fixtures";
import { cleanMessageId, hasParentLink, linkedIds, normalizeSubject, participantSet, sharesParticipant, threadKeyFor, isAutomatedHeaders, isGenericSubject, joinSubject, type ThreadingInput } from "./index";

type Addr = string;
type Input =
  | { fn: "normalizeSubject" | "joinSubject" | "isGenericSubject"; subject: string }
  | ({ fn: "threadKeyFor" | "hasParentLink" | "linkedIds" } & ThreadingInput)
  | { fn: "cleanMessageId"; value: string | null }
  | { fn: "sharesParticipant"; a: Addr[]; b: Addr[] }
  | { fn: "isAutomatedHeaders"; headers: Record<string, string> };
const fixture = loadFixture<Input, unknown>("threadkey");
const set = (l: Addr[]) => participantSet(l.map((address) => ({ name: "", address })));

describe("threadkey fixtures", () => {
  it.each(fixture.cases)("$name", ({ input, expect: want }) => {
    switch (input.fn) {
      case "normalizeSubject": return expect(normalizeSubject(input.subject)).toBe(want);
      case "joinSubject": return expect(joinSubject(input.subject)).toBe(want);
      case "isGenericSubject": return expect(isGenericSubject(input.subject)).toBe(want);
      case "cleanMessageId": return expect(cleanMessageId(input.value)).toBe(want);
      case "sharesParticipant": return expect(sharesParticipant(set(input.a), set(input.b))).toBe(want);
      case "isAutomatedHeaders": return expect(isAutomatedHeaders(input.headers)).toBe(want);
      case "threadKeyFor": return expect(threadKeyFor(input)).toBe(want);
      case "hasParentLink": return expect(hasParentLink(input)).toBe(want);
      case "linkedIds": return expect(linkedIds(input)).toEqual(want);
    }
  });
});
