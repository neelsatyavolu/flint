import { simpleParser } from "mailparser";
import { describe, expect, it } from "vitest";
import { buildMime } from "../mail/compose";
import type { ParsedInvite } from "./contracts";
import { buildImipReply } from "./imip";

const NOW = Date.UTC(2026, 9, 25, 18, 30, 5);
const start = Date.UTC(2026, 9, 27, 22, 0);

const invite = (over: Partial<ParsedInvite> = {}): ParsedInvite => ({
  uid: "7f3k2a9d8c@google.com", method: "REQUEST", sequence: 2, recurrenceId: null, title: "Design sync", description: null,
  start, end: start + 3600_000, allDay: false, startDate: null, endDate: null, timeZone: "America/Los_Angeles", recurrence: null,
  location: null, url: null, conference: null, organizer: { name: "Dana Whitfield", address: "dana@northwind.example" }, attendees: [],
  invitedAs: { address: "me@example.com", role: "required", rsvp: true }, dtstamp: null, source: "google", googleEventUrl: null, reply: null, ...over,
});
const me = { name: "Neel Rao", address: "me@example.com" };
const build = (over: Partial<ParsedInvite> = {}, extra: { response?: "accepted" | "tentative" | "declined"; note?: string } = {}) =>
  buildImipReply({ invite: invite(over), attendee: me, response: extra.response ?? "accepted", note: extra.note, now: NOW });

describe("buildImipReply", () => {
  it("writes a byte-exact METHOD:REPLY calendar part", () => {
    const r = build();
    expect(r.ics).toBe([
      "BEGIN:VCALENDAR", "PRODID:-//Flint//Flint Mail//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:REPLY", "BEGIN:VEVENT",
      "UID:7f3k2a9d8c@google.com", "SEQUENCE:2", "DTSTAMP:20261025T183005Z", "DTSTART:20261027T220000Z", "DTEND:20261027T230000Z",
      "ORGANIZER;CN=Dana Whitfield:mailto:dana@northwind.example",
      "ATTENDEE;CN=Neel Rao;PARTSTAT=ACCEPTED:mailto:me@example.com",
      "SUMMARY:Design sync", "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n"));
    expect(r.to).toEqual({ name: "Dana Whitfield", address: "dana@northwind.example" });
    expect(r.subject).toBe("Accepted: Design sync");
    expect(r.uid).toBe("7f3k2a9d8c@google.com");
  });

  it("maps answers to PARTSTAT and subject prefixes", () => {
    expect(build({}, { response: "tentative" }).ics).toContain("PARTSTAT=TENTATIVE");
    expect(build({}, { response: "tentative" }).subject).toBe("Tentative: Design sync");
    expect(build({}, { response: "declined" }).ics).toContain("PARTSTAT=DECLINED");
    expect(build({}, { response: "declined" }).subject).toBe("Declined: Design sync");
  });

  it("copies RECURRENCE-ID: UTC, zoned local, and date-only", () => {
    expect(build({ recurrenceId: "20261027T220000Z" }).ics).toContain("\r\nRECURRENCE-ID:20261027T220000Z\r\n");
    expect(build({ recurrenceId: "20261027T150000" }).ics).toContain("\r\nRECURRENCE-ID;TZID=America/Los_Angeles:20261027T150000\r\n");
    expect(build({ recurrenceId: "20261027" }).ics).toContain("\r\nRECURRENCE-ID;VALUE=DATE:20261027\r\n");
    expect(build().ics).not.toContain("RECURRENCE-ID");
  });

  it("uses DATE values for all-day events", () => {
    const r = build({ allDay: true, startDate: "2026-10-27", endDate: "2026-10-29", start: Date.UTC(2026, 9, 27), end: Date.UTC(2026, 9, 29) });
    expect(r.ics).toContain("DTSTART;VALUE=DATE:20261027\r\nDTEND;VALUE=DATE:20261029\r\n");
    expect(r.text).toContain("2026-10-27 to 2026-10-28");
  });

  it("escapes and folds the note and title, keeping UTF-8 intact and lines at 75 octets", () => {
    const note = `Can't wait, really; see you\nthere \\o/ ${"é".repeat(60)}`;
    const r = build({ title: "Q4 plan, v2; draft" }, { note });
    expect(r.ics).toContain("SUMMARY:Q4 plan\\, v2\\; draft\r\n");
    for (const line of r.ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    const unfolded = r.ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(`COMMENT:Can't wait\\, really\\; see you\\nthere \\\\o/ ${"é".repeat(60)}\r\n`);
  });

  it("quotes CN values with special characters and drops double quotes", () => {
    const r = buildImipReply({ invite: invite(), attendee: { name: 'Rao, Neel "N"', address: "me@example.com" }, response: "accepted", now: NOW });
    expect(r.ics).toContain(`ATTENDEE;CN="Rao, Neel 'N'";PARTSTAT=ACCEPTED:mailto:me@example.com`);
  });

  it("refuses an invitation without an organizer", () => {
    expect(() => build({ organizer: null })).toThrow(/no organizer/);
  });

  it("builds a message with exactly the text, html and text/calendar; method=REPLY parts and no tracking", async () => {
    const r = build({}, { note: "Running 5 min late <b>" });
    const raw = await buildMime({
      from: me, to: [r.to], subject: r.subject, text: r.text, html: r.html, icalEvent: { method: "REPLY", content: r.ics }, messageId: "m1@example.com", date: new Date(NOW),
    });
    const wire = raw.toString();
    expect(wire).toMatch(/Content-Type: multipart\/alternative/i);
    expect(wire).toMatch(/Content-Type: text\/calendar; charset=utf-8; method=REPLY/i);
    expect(wire).not.toMatch(/filename=/i);
    const parsed = await simpleParser(raw);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.contentType).toBe("text/calendar");
    expect(parsed.attachments[0]?.content.toString("utf8")).toBe(r.ics);
    expect(wire).not.toMatch(/Content-Type: application\/ics/i);
    expect(parsed.text).toContain("Neel Rao accepted this invitation.");
    expect(parsed.text).toContain("Running 5 min late <b>");
    expect(parsed.html).toContain("Running 5 min late &lt;b&gt;");
    expect(parsed.html).not.toMatch(/<img/i);
    expect(r.html).not.toMatch(/<img|http/i);
    expect(r.text).toContain("When: Tue, Oct 27, 2026, 3:00 PM to 4:00 PM (America/Los_Angeles)");
  });
});
