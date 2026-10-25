import { describe, expect, it } from "vitest";
import { buildGmailRaw, buildImapCriteria, inTargets } from "./server";
import { parseSearch } from "./parse";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

describe("buildGmailRaw", () => {
  it("maps operators to Gmail syntax", () => {
    const raw = buildGmailRaw(parseSearch('from:"Ann Lee" subject:invoice "exact phrase" -spam has:attachment is:unread after:2024-01-05 before:2024-02-01'));
    expect(raw).toBe('"exact phrase" -spam from:"Ann Lee" subject:invoice has:attachment is:unread after:2024/01/05 before:2024/02/01');
  });

  it("maps in: to Gmail locations and labels, pinned to starred", () => {
    expect(buildGmailRaw(parseSearch("in:sent budget"))).toBe("budget in:sent");
    expect(buildGmailRaw(parseSearch("in:archive budget"))).toBe("budget -in:inbox -in:sent -in:drafts");
    expect(buildGmailRaw(parseSearch("in:Receipts is:pinned"))).toBe("label:receipts is:starred");
    expect(buildGmailRaw(parseSearch("-from:bob@x.com"))).toBe("-from:bob@x.com");
  });

  it("returns null for a query with nothing to ask", () => {
    expect(buildGmailRaw(parseSearch(""))).toBeNull();
    expect(buildGmailRaw(parseSearch("account:me@x.com"))).toBeNull();
  });

  it("cannot be broken out of by quotes", () => {
    expect(buildGmailRaw(parseSearch('subject:"a\\"b"'))).not.toContain("\\");
  });
});

describe("buildImapCriteria", () => {
  it("maps operators to IMAP criteria", () => {
    const c = buildImapCriteria(parseSearch("from:ann to:bob cc:cy subject:invoice is:unread after:2024-01-05 before:2024-02-01 budget"));
    expect(c).toEqual({
      from: "ann", to: "bob", cc: "cy", subject: "invoice", text: "budget", seen: false,
      since: new Date(day(2024, 1, 5)), before: new Date(day(2024, 2, 1)),
    });
  });

  it("sends the longest bare word, skips negations and unsupported operators", () => {
    expect(buildImapCriteria(parseSearch("hi budgeting -junk"))).toEqual({ text: "budgeting" });
    expect(buildImapCriteria(parseSearch("-from:ann has:attachment"))).toBeNull();
    expect(buildImapCriteria(parseSearch("is:pinned"))).toEqual({ flagged: true });
    expect(buildImapCriteria(parseSearch("is:read"))).toEqual({ seen: true });
  });

  it("returns null when nothing can be searched", () => {
    expect(buildImapCriteria(parseSearch(""))).toBeNull();
  });
});

describe("inTargets", () => {
  it("separates roles from folder names", () => {
    expect(inTargets(parseSearch("in:sent in:Projects -in:trash"))).toEqual({ roles: ["sent"], names: ["projects"] });
  });
});
