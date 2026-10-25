import { describe, expect, it } from "vitest";
import { taskForPrompt, taskForReply, taskForStyle, taskForTranslate } from "./aiBarTasks";

const withText = { threadId: 5, draftId: 2, text: "Hello there" };
const empty = { threadId: null, draftId: 2, text: "  " };

describe("aiBar tasks", () => {
  it("prompt rewrites existing text and composes from nothing outside a thread", () => {
    const loose = { threadId: null, draftId: 2, text: "Hello there" };
    expect(taskForPrompt("make it warmer", loose)).toEqual({ kind: "rewrite", text: "Hello there", style: "make it warmer" });
    expect(taskForPrompt("ask for the invoice", empty)).toEqual({ kind: "compose", prompt: "ask for the invoice", draftId: 2 });
    expect(taskForPrompt("   ", withText)).toBeNull();
  });
  it("compose carries recipient and subject", () => {
    const t = taskForPrompt("ask for the invoice", { ...empty, to: "Sam <sam@x.co>", subject: "Invoice" });
    expect(t).toEqual({ kind: "compose", prompt: "To: Sam <sam@x.co>\nSubject: Invoice\n\nask for the invoice", draftId: 2 });
  });
  it("in a thread, free text stays a reply so the model sees the conversation", () => {
    expect(taskForPrompt("say I can do Thursday", { threadId: 5, draftId: 2, text: " " })).toEqual({
      kind: "reply", threadId: 5, instructions: "say I can do Thursday",
    });
    const t = taskForPrompt("tell them I can't make Tuesday", withText);
    expect(t).toMatchObject({ kind: "reply", threadId: 5 });
    expect((t as { instructions: string }).instructions).toContain("tell them I can't make Tuesday");
    expect((t as { instructions: string }).instructions).toContain("Hello there");
  });
  it("a selection is rewritten in place, and an oversized draft falls back to rewrite", () => {
    expect(taskForPrompt("warmer", { ...withText, scope: "selection" })).toEqual({ kind: "rewrite", text: "Hello there", style: "warmer" });
    const big = "x".repeat(3000);
    expect(taskForPrompt("shorter", { threadId: 5, text: big })).toMatchObject({ kind: "rewrite" });
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
