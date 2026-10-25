// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequestFilter, receiptsHostFromEndpoint } from "./request-filter";
import { hostMatchesList, isTrackerHost } from "./trackers";

describe("receiptsHostFromEndpoint", () => {
  it("extracts the lowercase host", () => {
    expect(receiptsHostFromEndpoint("https://Receipts.Example.com/v1")).toBe("receipts.example.com");
    expect(receiptsHostFromEndpoint("http://localhost:8787")).toBe("localhost");
  });
  it("returns null for empty or invalid values", () => {
    expect(receiptsHostFromEndpoint("")).toBeNull();
    expect(receiptsHostFromEndpoint("  ")).toBeNull();
    expect(receiptsHostFromEndpoint("not a url")).toBeNull();
  });
});

describe("createRequestFilter", () => {
  it("blocks the receipts host exactly, whatever the path or port", () => {
    const f = createRequestFilter({ receiptsHost: "r.example.com", blockTrackers: false });
    expect(f.shouldBlock("https://r.example.com/i/abc.gif")).toBe(true);
    expect(f.shouldBlock("https://R.EXAMPLE.com:8443/i/abc.gif")).toBe(true);
    expect(f.shouldBlock("https://example.com/")).toBe(false);
    expect(f.shouldBlock("https://sub.r.example.com/")).toBe(false);
    expect(f.shouldBlock("garbage")).toBe(false);
  });
  it("blocks trackers only when enabled and follows updates", () => {
    const f = createRequestFilter({ receiptsHost: null, blockTrackers: true });
    expect(f.shouldBlock("https://u1.ct.sendgrid.net/wf/open")).toBe(true);
    f.update({ blockTrackers: false });
    expect(f.shouldBlock("https://u1.ct.sendgrid.net/wf/open")).toBe(false);
    f.update({ receiptsHost: "new.example.com" });
    expect(f.shouldBlock("https://new.example.com/i/x.gif")).toBe(true);
  });
  it("does nothing by default for ordinary hosts", () => {
    expect(createRequestFilter().shouldBlock("https://example.com/logo.png")).toBe(false);
  });
});

describe("tracker list", () => {
  it("matches hosts and subdomains on a dot boundary", () => {
    expect(isTrackerHost("mailtrack.io")).toBe(true);
    expect(isTrackerHost("pixel.MAILTRACK.io.")).toBe(true);
    expect(isTrackerHost("notmailtrack.io")).toBe(false);
    expect(isTrackerHost("example.com")).toBe(false);
    expect(hostMatchesList("a.b.c", ["b.c"])).toBe(true);
  });
});
