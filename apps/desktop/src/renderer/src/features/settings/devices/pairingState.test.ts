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
    expect(nextView(done, { type: "closed", reason: "cancelled", bundleSent: false })).toBe(done);
  });
  it("does not say nothing was sent once the bundle may have left", () => {
    for (const reason of ["failed", "connection_lost"] as const) {
      const before = nextView(START, { type: "closed", reason, bundleSent: false }) as { message: string };
      const after = nextView(START, { type: "closed", reason, bundleSent: true }) as { message: string };
      expect(after.message).not.toBe(before.message);
      expect(after.message).not.toMatch(/Nothing was (sent|saved)/);
      expect(after.message).toMatch(/may have|started sending/);
    }
  });
  it("names the cause when the library is too large", () => {
    expect((nextView(START, { type: "closed", reason: "too_large", bundleSent: false }) as { message: string }).message).toMatch(/too large/);
  });
  it("explains every way a session can end without exclamation marks", () => {
    for (const reason of ["expired", "cancelled", "denied", "too_many_attempts", "connection_lost", "failed", "no_ack", "too_large"] as const) {
      const v = nextView(START, { type: "closed", reason, bundleSent: false });
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
