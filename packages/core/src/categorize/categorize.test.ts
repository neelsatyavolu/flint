import { describe, expect, it } from "vitest";
import { categorize, rollupCategory } from "./index";

const from = (address: string) => ({ name: "", address });
const run = (address: string, headers: Record<string, string> = {}, isKnownContact = false) =>
  categorize({ from: from(address), headers, isKnownContact });

describe("categorize", () => {
  it("plain person is people", () => {
    expect(run("carla@example.com")).toBe("people");
  });

  it("known contacts always win", () => {
    expect(run("noreply@x.com", { "list-id": "<a.b>" }, true)).toBe("people");
  });

  it("list headers mean newsletters", () => {
    expect(run("news@brand.com", { "list-unsubscribe": "<mailto:u@brand.com>" })).toBe("newsletters");
    expect(run("a@b.com", { "list-id": "<announce.b.com>" })).toBe("newsletters");
    expect(run("noreply@brand.com", { "list-unsubscribe": "<https://x>" })).toBe("newsletters");
  });

  it.each(["noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "notifications", "notification", "alerts", "update", "updates", "mailer-daemon", "bounce", "bounces", "info", "support", "team", "hello", "NoReply", "no-reply+abc123", "notifications-1"])(
    "automated local part %s is notifications",
    (local) => expect(run(`${local}@example.com`)).toBe("notifications"),
  );

  it.each(["infoman", "helloween", "teammate", "supportive", "alertsmith"])("person-like local part %s stays people", (local) => {
    expect(run(`${local}@example.com`)).toBe("people");
  });

  it("auto-submitted other than no is notifications", () => {
    expect(run("a@b.com", { "auto-submitted": "auto-generated" })).toBe("notifications");
    expect(run("a@b.com", { "auto-submitted": "auto-replied" })).toBe("notifications");
    expect(run("a@b.com", { "auto-submitted": "no" })).toBe("people");
    expect(run("a@b.com", { "auto-submitted": "" })).toBe("people");
  });

  it("bulk precedence without list headers is notifications", () => {
    expect(run("a@b.com", { precedence: "bulk" })).toBe("notifications");
    expect(run("a@b.com", { precedence: "List" })).toBe("notifications");
    expect(run("a@b.com", { precedence: "junk" })).toBe("notifications");
    expect(run("a@b.com", { precedence: "first-class" })).toBe("people");
  });

  it("handles a missing sender", () => {
    expect(categorize({ from: null, headers: {}, isKnownContact: false })).toBe("people");
  });
});

describe("rollupCategory", () => {
  it("is people when any message is people", () => {
    expect(rollupCategory([{ category: "newsletters", date: 1 }, { category: "people", date: 2 }])).toBe("people");
  });
  it("uses the latest message otherwise", () => {
    expect(rollupCategory([{ category: "newsletters", date: 1 }, { category: "notifications", date: 2 }])).toBe("notifications");
  });
  it("defaults to people", () => {
    expect(rollupCategory([])).toBe("people");
    expect(rollupCategory([{ category: null, date: 1 }])).toBe("people");
  });
});
