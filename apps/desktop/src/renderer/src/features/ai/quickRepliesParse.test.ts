import { describe, expect, it } from "vitest";
import { parseQuickReplies } from "./quickRepliesParse";

describe("parseQuickReplies", () => {
  it("reads a JSON array", () => {
    expect(parseQuickReplies('["Sounds good.", "Can we do Thursday?", "Let me check."]')).toEqual(["Sounds good.", "Can we do Thursday?", "Let me check."]);
  });
  it("reads a fenced array inside prose and caps at three", () => {
    expect(parseQuickReplies('Here you go:\n```json\n["a","b","c","d"]\n```')).toEqual(["a", "b", "c"]);
  });
  it("accepts objects with a text field", () => {
    expect(parseQuickReplies('[{"text":"Yes"},{"text":"No"}]')).toEqual(["Yes", "No"]);
  });
  it("falls back to lines and strips bullets and numbers", () => {
    expect(parseQuickReplies("1. Works for me\n- Not this week\n* Call me")).toEqual(["Works for me", "Not this week", "Call me"]);
  });
  it("returns nothing for empty output", () => {
    expect(parseQuickReplies("  ")).toEqual([]);
  });
});
