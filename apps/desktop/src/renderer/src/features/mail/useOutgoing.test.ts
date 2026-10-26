import { describe, expect, it } from "vitest";
import type { OutgoingSend } from "@flint/core";
import { outgoingStatus } from "./OutgoingCard";
import { DEPARTED_MAX_MS, settleDeparted } from "./useOutgoing";

const T = 1_000_000;
const send = (over: Partial<OutgoingSend> = {}): OutgoingSend => ({ scheduledId: 7, draftId: 3, sendAt: T + 10_000, status: "pending", ...over });
const empty = { outgoing: [], draftIds: [], messages: [] };

describe("settleDeparted", () => {
  it("keeps a send that went out until its Sent copy arrives", () => {
    const gone = settleDeparted([send()], [], empty, T + 11_000);
    expect(gone.map((d) => d.scheduledId)).toEqual([7]);
    expect(settleDeparted([], gone, { ...empty, messages: [{ isFromMe: false, date: T + 12_000 }] }, T + 12_000)).toHaveLength(1);
    expect(settleDeparted([], gone, { ...empty, messages: [{ isFromMe: true, date: T + 10_500 }] }, T + 13_000)).toEqual([]);
  });

  it("drops a send that was undone or failed: its draft is back", () => {
    expect(settleDeparted([send()], [], { ...empty, draftIds: [3] }, T + 2_000)).toEqual([]);
  });

  it("ignores a send that is still queued", () => {
    expect(settleDeparted([send()], [], { ...empty, outgoing: [send({ status: "sending" })] }, T + 11_000)).toEqual([]);
  });

  it("gives up after a minute", () => {
    const gone = settleDeparted([send()], [], empty, T);
    expect(settleDeparted([], gone, empty, T + DEPARTED_MAX_MS)).toEqual([]);
  });
});

describe("outgoingStatus", () => {
  it("counts down inside the undo window, then says where the send is", () => {
    expect(outgoingStatus(send(), T + 2_500, false)).toBe("Sending in 8s");
    expect(outgoingStatus(send(), T + 10_000, false)).toBe("Sending…");
    expect(outgoingStatus(send({ status: "sending" }), T, false)).toBe("Sending…");
    expect(outgoingStatus(send({ status: "awaiting_approval" }), T, false)).toBe("Waiting for approval");
    expect(outgoingStatus(send(), T, true)).toBe("Sent");
    expect(outgoingStatus(send({ sendAt: T + 3_600_000 }), T, false)).toMatch(/^Scheduled for /);
  });
});
