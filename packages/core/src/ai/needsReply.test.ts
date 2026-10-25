import { describe, expect, it } from "vitest";
import { detectNeedsReply, replyReason } from "./needsReply";
import type { AiThreadBrief } from "./ports";

const NOW = Date.UTC(2026, 9, 25, 12);
const brief = (over: Partial<AiThreadBrief>): AiThreadBrief => ({
  threadId: 1, subject: "Plan", date: NOW - 3_600_000, from: { name: "Ana", address: "ana@x.com" },
  lastText: "Hi, are you free Thursday?", unreadCount: 1, messageCount: 2, lastFromMe: false, answered: false, ...over,
});

describe("replyReason", () => {
  it("finds questions and ignores question marks in URLs and quotes", () => {
    expect(replyReason("Are you free Thursday?")).toBe("question");
    expect(replyReason("See https://x.com/a?b=1 for details.")).toBeNull();
    expect(replyReason("> did you see this?\nThanks for the note.")).toBeNull();
  });
  it("finds requests without a question mark", () => {
    expect(replyReason("Please confirm the time by tomorrow.")).toBe("request");
    expect(replyReason("Let me know what works.")).toBe("request");
  });
  it("leaves plain statements alone", () => {
    expect(replyReason("Thanks, got it. See you then.")).toBeNull();
    expect(replyReason("")).toBeNull();
  });
});

describe("detectNeedsReply", () => {
  it("keeps unanswered asks from other people", () => {
    expect(detectNeedsReply([brief({})], NOW).map((i) => i.threadId)).toEqual([1]);
  });
  it("drops threads the user wrote last or already answered", () => {
    expect(detectNeedsReply([brief({ lastFromMe: true }), brief({ threadId: 2, answered: true })], NOW)).toEqual([]);
  });
  it("drops no-reply senders and stale threads", () => {
    const list = [
      brief({ threadId: 3, from: { name: "", address: "no-reply@x.com" } }),
      brief({ threadId: 4, date: NOW - 20 * 86_400_000 }),
    ];
    expect(detectNeedsReply(list, NOW)).toEqual([]);
  });
  it("sorts newest first and caps the list", () => {
    const list = Array.from({ length: 12 }, (_, i) => brief({ threadId: i + 1, date: NOW - i * 60_000 }));
    const out = detectNeedsReply(list, NOW, 5);
    expect(out).toHaveLength(5);
    expect(out[0]!.threadId).toBe(1);
  });
});
