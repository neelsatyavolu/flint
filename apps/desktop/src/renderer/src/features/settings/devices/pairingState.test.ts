import { describe, expect, it } from "vitest";
import { countdown, countsSentence, nextView, START, type PairingView } from "./pairingState";

describe("nextView", () => {
  it("walks listening, approval, sending, done", () => {
    let v: PairingView = START;
    v = nextView(v, { type: "listening", svg: "<svg/>", expiresAt: 10, addrs: ["10.0.0.2"] });
    expect(v).toMatchObject({ step: "listening", addrs: ["10.0.0.2"] });
    v = nextView(v, { type: "approval", deviceName: "Neel's iPhone", sas: "482 913", passwordAccounts: 2 });
    expect(v).toMatchObject({ step: "approval", sas: "482 913" });
    v = nextView(v, { type: "sending" });
    expect(v.step).toBe("sending");
    v = nextView(v, { type: "done", deviceName: "Neel's iPhone", counts: { accounts: 2, signatures: 0, templates: 0, rules: 12, blockedSenders: 0 } });
    expect(v.step).toBe("done");
  });
  it("keeps the summary when the session closes after done", () => {
    const done = nextView(START, { type: "done", deviceName: "x", counts: { accounts: 1, signatures: 0, templates: 0, rules: 0, blockedSenders: 0 } });
    expect(nextView(done, { type: "closed", reason: "cancelled" })).toBe(done);
  });
  it("explains every way a session can end without exclamation marks", () => {
    for (const reason of ["expired", "cancelled", "denied", "too_many_attempts", "connection_lost", "failed", "no_ack"] as const) {
      const v = nextView(START, { type: "closed", reason });
      expect(v.step).toBe("ended");
      expect((v as { message: string }).message).not.toContain("!");
      expect((v as { retry: boolean }).retry).toBe(true);
    }
    expect(nextView(START, { type: "error", message: "No private network found." })).toMatchObject({ step: "ended", message: "No private network found." });
  });
});

describe("copy", () => {
  it("summarises counts", () => {
    expect(countsSentence({ accounts: 2, signatures: 1, templates: 0, rules: 12, blockedSenders: 0 })).toBe("Added 2 accounts, 1 signature, 12 rules.");
    expect(countsSentence({ accounts: 0, signatures: 0, templates: 0, rules: 0, blockedSenders: 0 })).toMatch(/already had everything/);
  });
  it("counts down without going negative", () => {
    expect(countdown(181_000, 1000)).toBe("3:00");
    expect(countdown(5_000, 1000)).toBe("0:04");
    expect(countdown(1000, 9000)).toBe("0:00");
  });
});
