import { describe, expect, it } from "vitest";
import { loadFixture } from "../../fixtures";
import type { ReceiptStatus } from "../types";
import { FORWARD_GAP_MS, isPossiblyForwarded, recipientNote, recipientStatus, summarize } from "./receiptStatus";

type Event = { at: number; kind: string; client: string | null; fingerprint: string | null };
type Input =
  | { fn: "recipient"; events: Event[]; repliedAt: number | null; registered: boolean; untrackedReason: string | null }
  | { fn: "summarize"; recipients: { status: ReceiptStatus; lastOpenAt: number | null }[] };
const fixture = loadFixture<Input, any, { forwardGapMs: number }>("receipts-status");

describe("receipts-status fixtures", () => {
  it("pins the forward gap", () => expect(fixture.meta.forwardGapMs).toBe(FORWARD_GAP_MS));

  it.each(fixture.cases)("$name", ({ input, expect: want }) => {
    if (input.fn === "summarize") return expect(summarize(input.recipients)).toEqual(want);
    // Mirrors ReceiptsRepo.recomputeRecipient: only kind "open" is counted; any "prefetch" marks the recipient unknowable.
    const counted = input.events.filter((e) => e.kind === "open").sort((a, b) => a.at - b.at);
    const status = recipientStatus({ openCount: counted.length, repliedAt: input.repliedAt, sawPrefetch: input.events.some((e) => e.kind === "prefetch"), registered: input.registered });
    expect({
      status, openCount: counted.length, firstOpenAt: counted[0]?.at ?? null, lastOpenAt: counted.at(-1)?.at ?? null,
      note: recipientNote(status, input.registered, input.untrackedReason), possiblyForwarded: isPossiblyForwarded(counted),
    }).toEqual(want);
  });
});
