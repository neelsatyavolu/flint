import { describe, expect, it } from "vitest";
import { checkAlias, describeStatus } from "./accountStatus";

describe("describeStatus", () => {
  it("flags expired sign-in", () => {
    expect(describeStatus({ accountId: "a", state: "auth_error" }, true)).toMatchObject({ tone: "err", needsSignIn: true });
  });
  it("shows progress and pause", () => {
    expect(describeStatus({ accountId: "a", state: "syncing", progress: { done: 3, total: 9 } }, true).text).toBe("Syncing 3 of 9");
    expect(describeStatus(undefined, false).text).toBe("Paused");
    expect(describeStatus(undefined, true).text).toBe("Waiting to sync");
  });
  it("reports errors, offline and synced", () => {
    expect(describeStatus({ accountId: "a", state: "error", error: "Timed out" }, true).text).toBe("Timed out");
    expect(describeStatus({ accountId: "a", state: "offline" }, true).tone).toBe("warn");
    expect(describeStatus({ accountId: "a", state: "idle" }, true).text).toBe("Up to date");
    expect(describeStatus({ accountId: "a", state: "idle", lastSyncAt: Date.now() }, true).text).toMatch(/^Synced /);
  });
});

describe("checkAlias", () => {
  it("accepts and lowercases", () => expect(checkAlias(" Hi@X.com ", "me@x.com", [])).toEqual({ ok: true, value: "hi@x.com" }));
  it("rejects bad, own and duplicate", () => {
    expect(checkAlias("nope", "me@x.com", []).ok).toBe(false);
    expect(checkAlias("ME@x.com", "me@x.com", []).ok).toBe(false);
    expect(checkAlias("a@x.com", "me@x.com", ["a@x.com"]).ok).toBe(false);
  });
});
