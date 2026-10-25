import { describe, expect, it } from "vitest";
import { taskForPrompt, taskForReply, taskForStyle, taskForTranslate } from "./aiBarTasks";

const withText = { threadId: 5, draftId: 2, text: "Hello there" };
const empty = { threadId: null, draftId: 2, text: "  " };

describe("aiBar tasks", () => {
  it("prompt rewrites existing text and composes from nothing", () => {
    expect(taskForPrompt("make it warmer", withText)).toEqual({ kind: "rewrite", text: "Hello there", style: "make it warmer" });
    expect(taskForPrompt("ask for the invoice", empty)).toEqual({ kind: "compose", prompt: "ask for the invoice", draftId: 2 });
    expect(taskForPrompt("   ", withText)).toBeNull();
  });
  it("reply uses the thread, else needs instructions", () => {
    expect(taskForReply(withText, "")).toEqual({ kind: "reply", threadId: 5, instructions: undefined });
    expect(taskForReply(empty, "")).toBeNull();
    expect(taskForReply(empty, "decline politely")).toEqual({ kind: "compose", prompt: "decline politely", draftId: 2 });
  });
  it("style and translate need text", () => {
    expect(taskForStyle("shorter", empty)).toBeNull();
    expect(taskForStyle("shorter", withText)).toEqual({ kind: "rewrite", text: "Hello there", style: "shorter" });
    expect(taskForTranslate("French", withText)).toEqual({ kind: "translate", text: "Hello there", language: "French" });
  });
});
