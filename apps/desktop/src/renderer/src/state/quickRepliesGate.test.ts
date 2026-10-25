import { describe, expect, it } from "vitest";
import type { MessageView } from "@flint/core";
import { quickRepliesEligible, quickRepliesKey } from "./quickRepliesGate";

const msg = (o: Partial<MessageView> & { addr?: string }): MessageView =>
  ({ id: 1, date: 100, isFromMe: false, unsubscribe: null, from: [{ name: "", address: o.addr ?? "sam@example.com" }], ...o }) as unknown as MessageView;

describe("quickRepliesEligible", () => {
  it("allows a person writing last", () => expect(quickRepliesEligible("people", [msg({})])).toBe(true));
  it("skips bulk categories", () => expect(quickRepliesEligible("newsletters", [msg({})])).toBe(false));
  it("skips when the user spoke last", () => expect(quickRepliesEligible("people", [msg({}), msg({ id: 2, isFromMe: true })])).toBe(false));
  it("skips list mail", () => expect(quickRepliesEligible("people", [msg({ unsubscribe: { oneClick: false } })])).toBe(false));
  it("skips no-reply senders", () => {
    expect(quickRepliesEligible("people", [msg({ addr: "no-reply@x.com" })])).toBe(false);
    expect(quickRepliesEligible("people", [msg({ addr: "noreply@x.com" })])).toBe(false);
    expect(quickRepliesEligible("people", [msg({ addr: "replyguy@x.com" })])).toBe(true);
  });
  it("skips empty threads", () => expect(quickRepliesEligible("people", [])).toBe(false));
});

describe("quickRepliesKey", () => {
  it("changes when a newer message arrives", () => {
    expect(quickRepliesKey(5, [msg({ id: 1 })])).not.toBe(quickRepliesKey(5, [msg({ id: 1 }), msg({ id: 2, date: 200 })]));
  });
});
