import { describe, expect, it } from "vitest";
import { decodeIcs, isCalendarAttachment, ownAddressesOf, parseAndStore } from "./capture";
import { NOW, fixture } from "./fixtures";
import { INVITE_PARSER_VERSION, type StoredInvite } from "./contracts";

describe("isCalendarAttachment", () => {
  it.each([
    [{ contentType: "text/calendar", filename: "attachment-2.ics" }, true],
    [{ contentType: "TEXT/CALENDAR", filename: "" }, true],
    [{ contentType: "application/ics", filename: "x" }, true],
    [{ contentType: "application/octet-stream", filename: "invite.ICS" }, true],
    [{ contentType: "application/pdf", filename: "a.pdf" }, false],
    [{ contentType: "text/plain", filename: "notes.txt" }, false],
  ])("%j", (a, expected) => { expect(isCalendarAttachment(a)).toBe(expected); });
});

describe("decodeIcs", () => {
  it("decodes UTF-8 and drops a BOM", () => {
    expect(decodeIcs(Buffer.from("﻿SUMMARY:Café", "utf8"))).toBe("SUMMARY:Café");
  });
  it("falls back to Latin-1 for bytes that are not UTF-8", () => {
    expect(decodeIcs(Buffer.from([0x43, 0x61, 0x66, 0xe9]))).toBe("Café");
  });
});

describe("ownAddressesOf", () => {
  it("lists the email and aliases once, lower case", () => {
    expect(ownAddressesOf({ email: "Me@Example.com", aliases: ["me@example.com", "Neel@Example.com", " "] })).toEqual(["me@example.com", "neel@example.com"]);
  });
});

describe("parseAndStore", () => {
  it("saves the parse with the text and parser version", () => {
    const saved: StoredInvite[] = [];
    const out = parseAndStore(fixture("brand-review-v1.ics"), { store: { saveInvite: (i) => { saved.push(i as StoredInvite); } }, accountId: "a1", messageId: 5, ownAddresses: ["me@example.com"], now: NOW });
    expect(saved).toHaveLength(1);
    expect(out).toMatchObject({ messageId: 5, accountId: "a1", parserVersion: INVITE_PARSER_VERSION, parsedAt: NOW });
    expect(out?.invite.invitedAs?.address).toBe("me@example.com");
    expect(out?.ics).toContain("BEGIN:VCALENDAR");
  });
  it("saves nothing when the text is not an event", () => {
    const saved: unknown[] = [];
    expect(parseAndStore("nope", { store: { saveInvite: (i) => { saved.push(i); } }, accountId: "a1", messageId: 5, ownAddresses: [], now: NOW })).toBeNull();
    expect(saved).toHaveLength(0);
  });
});
