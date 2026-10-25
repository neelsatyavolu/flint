import { describe, expect, it } from "vitest";
import { cleanMessageId, hasParentLink, linkedIds, normalizeSubject, participantSet, sharesParticipant, threadKeyFor } from "./index";

describe("normalizeSubject", () => {
  it.each([
    ["Re: Lunch", "lunch"],
    ["RE: re: Fwd: Lunch", "lunch"],
    ["AW: Mittagessen", "mittagessen"],
    ["Sv: Lunch", "lunch"],
    ["[dev-list] Re: build broke", "build broke"],
    ["Re[2]: Plan", "plan"],
    ["  Spaced   out  ", "spaced out"],
    ["Fw: x", "x"],
    ["Return of the king", "return of the king"],
    ["", ""],
  ])("%s -> %s", (input, expected) => expect(normalizeSubject(input)).toBe(expected));
});

describe("threadKeyFor", () => {
  const base = { messageId: "own@x", inReplyTo: null, references: [] as string[] };
  it("prefers gmail thread id", () => expect(threadKeyFor({ ...base, gmThrid: "123" })).toBe("gm:123"));
  it("uses first reference", () => expect(threadKeyFor({ ...base, inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>"] })).toBe("mid:a@x"));
  it("then in-reply-to", () => expect(threadKeyFor({ ...base, inReplyTo: "<b@x>" })).toBe("mid:b@x"));
  it("then own id", () => expect(threadKeyFor(base)).toBe("mid:own@x"));
  it("null with nothing", () => expect(threadKeyFor({ messageId: null, inReplyTo: null, references: [] })).toBeNull());
});

describe("helpers", () => {
  it("cleanMessageId strips brackets", () => {
    expect(cleanMessageId(" <a@b> ")).toBe("a@b");
    expect(cleanMessageId("")).toBeNull();
    expect(cleanMessageId(null)).toBeNull();
  });
  it("hasParentLink and linkedIds", () => {
    expect(hasParentLink({ messageId: "x", inReplyTo: null, references: [] })).toBe(false);
    expect(hasParentLink({ messageId: "x", inReplyTo: "<p@x>", references: [] })).toBe(true);
    expect(linkedIds({ messageId: "x", inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>"] })).toEqual(["a@x", "b@x"]);
  });
  it("participants", () => {
    const a = participantSet([{ name: "", address: "A@x.com" }]);
    expect(sharesParticipant(a, participantSet([{ name: "", address: "a@x.com" }]))).toBe(true);
    expect(sharesParticipant(a, participantSet([{ name: "", address: "b@x.com" }]))).toBe(false);
  });
});
