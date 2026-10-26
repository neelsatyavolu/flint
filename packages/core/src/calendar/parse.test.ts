import { describe, expect, it } from "vitest";
import { parseInvite } from "./parse";
import { NOW, OWN, fixture, parsed } from "./fixtures";

const utc = (y: number, mo: number, d: number, h = 0, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi);

describe("Google weekly invite with Meet", () => {
  const inv = parsed("google-weekly-meet.ics");
  it("reads the event and converts the organizer's zone", () => {
    expect(inv).toMatchObject({
      uid: "6mk3qd8c1p2v9rj4tb0h5s7xyz@google.com", method: "REQUEST", sequence: 0, recurrenceId: null, title: "Design sync", allDay: false,
      timeZone: "America/Los_Angeles", source: "google",
    });
    expect(inv.start).toBe(utc(2026, 10, 27, 22));
    expect(inv.end).toBe(utc(2026, 10, 27, 23));
    expect(inv.dtstamp).toBe(utc(2026, 10, 20, 18, 15) + 30_000);
  });
  it("summarizes the recurrence in the event's zone", () => {
    expect(inv.recurrence).toEqual({ summary: "Weekly on Tuesday until Dec 12", rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261213T075959Z", hasExceptions: false, excluded: [], added: [] });
  });
  it("unescapes the location and finds the Meet call", () => {
    expect(inv.location).toBe("Room 4B, Northwind HQ, 500 Howard St, San Francisco, CA 94105");
    expect(inv.conference).toEqual({ kind: "meet", url: "https://meet.google.com/abc-defg-hij", label: "Google Meet", code: "abc-defg-hij", phone: "+1 650-555-0142" });
  });
  it("drops Google's generated join block from the description", () => {
    expect(inv.description).toBe("Weekly design review: roadmap, open questions, and demos.\n\nBring one thing you are stuck on.");
  });
  it("reads guests and marks the user", () => {
    expect(inv.organizer).toEqual({ name: "Carla Ortiz", address: "carla@northwind.example" });
    expect(inv.attendees).toHaveLength(6);
    expect(inv.attendees.map((a) => a.response)).toEqual(["accepted", "needs-action", "accepted", "tentative", "declined", "needs-action"]);
    expect(inv.attendees.find((a) => a.address === "sam@northwind.example")).toMatchObject({ role: "optional", response: "declined" });
    expect(inv.attendees.filter((a) => a.isYou).map((a) => a.address)).toEqual(["me@example.com"]);
    expect(inv.invitedAs).toEqual({ address: "me@example.com", role: "required", rsvp: true });
  });
  it("builds a Google event link from the Google-generated uid", () => {
    const eid = Buffer.from("6mk3qd8c1p2v9rj4tb0h5s7xyz me@example.com").toString("base64").replace(/=+$/, "");
    expect(inv.googleEventUrl).toBe(`https://www.google.com/calendar/event?eid=${eid}`);
  });
});

describe("updates, cancellations, instances", () => {
  it("keeps SEQUENCE and the new time of an update", () => {
    const v0 = parsed("brand-review-v0.ics");
    const v1 = parsed("brand-review-v1.ics");
    expect(v0.sequence).toBe(0);
    expect(v1.sequence).toBe(2);
    expect(v1.uid).toBe(v0.uid);
    expect(v1.start).toBe(utc(2026, 10, 30, 19));
    expect(v1.location).toBe("Studio 5");
    expect(v1.timeZone).toBe("UTC");
  });
  it("treats METHOD:CANCEL as a cancellation", () => {
    expect(parsed("brand-review-cancel.ics")).toMatchObject({ method: "CANCEL", sequence: 3 });
  });
  it("normalizes RECURRENCE-ID to UTC for a single occurrence", () => {
    const inv = parsed("google-instance-update.ics");
    expect(inv.recurrenceId).toBe("20261103T230000Z");
    expect(inv.start).toBe(utc(2026, 11, 4, 0, 30));
    expect(inv.recurrence).toBeNull();
  });
  it("reads a REPLY", () => {
    const inv = parsed("google-reply.ics");
    expect(inv.method).toBe("REPLY");
    expect(inv.reply).toEqual({ from: { name: "Carla Ortiz", address: "carla@northwind.example" }, response: "accepted", comment: "Happy to join. I will bring the draft." });
    expect(inv.invitedAs).toBeNull();
  });
  it("turns STATUS:CANCELLED into a cancellation even without METHOD:CANCEL", () => {
    const ics = fixture("publish-webinar.ics").replace("DTSTAMP:", "STATUS:CANCELLED\r\nDTSTAMP:");
    expect(parseInvite(ics, { ownAddresses: OWN, now: NOW })?.method).toBe("CANCEL");
  });
});

describe("Outlook and Exchange", () => {
  it("maps the Windows zone name and finds the Zoom call in LOCATION", () => {
    const inv = parsed("outlook-zoom.ics");
    expect(inv.timeZone).toBe("America/Los_Angeles");
    expect(inv.start).toBe(utc(2026, 10, 28, 17, 30));
    expect(inv.source).toBe("outlook");
    expect(inv.conference).toMatchObject({ kind: "zoom", label: "Zoom", url: "https://contoso.zoom.us/j/81234567890?pwd=AbCdEf123", code: "812 3456 7890", phone: "+1 669 900 6833" });
    expect(inv.location).toBeNull();
    expect(inv.description).toBeNull();
    expect(inv.organizer).toEqual({ name: "Priya Raman", address: "priya.raman@contoso.example" });
    expect(inv.invitedAs).toEqual({ address: "me@example.com", role: "required", rsvp: true });
  });
  it("handles Teams: Eastern Standard Time after DST ends, quoted CN with a comma, join block removed", () => {
    const inv = parsed("outlook-teams.ics");
    expect(inv.timeZone).toBe("America/New_York");
    expect(inv.start).toBe(utc(2026, 11, 2, 19));
    expect(inv.end).toBe(utc(2026, 11, 2, 20, 30));
    expect(inv.organizer?.name).toBe("Ellis, Jordan");
    expect(inv.conference).toMatchObject({ kind: "teams", label: "Microsoft Teams", code: "245 987 133 410" });
    expect(inv.location).toBeNull();
    expect(inv.description).toBe("Quarterly planning. Agenda is in the shared doc.");
    expect(inv.attendees.find((a) => a.address === "rosa@fabrikam.example")?.role).toBe("optional");
  });
  it("picks the master of a series with exceptions", () => {
    const inv = parsed("outlook-recurring-exceptions.ics");
    expect(inv.title).toBe("Standup");
    expect(inv.sequence).toBe(4);
    expect(inv.recurrence?.summary).toBe("Every weekday");
    expect(inv.recurrence?.hasExceptions).toBe(true);
    expect(inv.start).toBe(utc(2026, 10, 12, 16, 30));
    expect(inv.location).toBe("Huddle room 2");
  });
  it("uses the VTIMEZONE of a custom zone name", () => {
    const inv = parsed("custom-vtimezone.ics");
    expect(inv.start).toBe(utc(2026, 11, 9, 9));
    expect(inv.timeZone).toBeNull();
    expect(inv.invitedAs?.address).toBe("me@example.com");
  });
});

describe("other producers", () => {
  it("reads an iCloud all-day, multi-day event with exclusive DTEND", () => {
    const inv = parsed("apple-allday.ics");
    expect(inv).toMatchObject({ allDay: true, startDate: "2026-11-12", endDate: "2026-11-15", timeZone: null, source: "apple" });
    expect(inv.start).toBe(utc(2026, 11, 12));
    expect(inv.end).toBe(utc(2026, 11, 15));
    expect(inv.location).toBe("Lakeview Lodge, Big Bear Lake, CA");
    expect(inv.attendees.find((a) => a.address === "hana@icloud.example")?.role).toBe("chair");
  });
  it("reads a Zoom-generated invite", () => {
    const inv = parsed("zoom-scheduled.ics");
    expect(inv.source).toBe("zoom");
    expect(inv.conference).toMatchObject({ kind: "zoom", code: "987 6543 2101" });
    expect(inv.location).toBeNull();
    expect(inv.description).toBeNull();
  });
  it("reads a PUBLISH event with its URL", () => {
    const inv = parsed("publish-webinar.ics");
    expect(inv).toMatchObject({ method: "PUBLISH", url: "https://events.example/e/5521337", invitedAs: null, conference: null, location: null });
    expect(inv.start).toBe(utc(2026, 11, 18, 18));
  });
  it("unfolds lines and unescapes text, even mid-word and mid-UTF-8", () => {
    const inv = parsed("folded-crlf.ics");
    expect(inv.title).toBe("Planning, budget; and a very long title that the sender folded across two lines for good measure");
    expect(inv.description).toBe("Line one\nLine two with a backslash \\ and a comma, plus unicode café split mid-word");
    expect(inv.location).toBe("Café Roma, 12 Via Appia");
    expect(inv.invitedAs?.rsvp).toBe(true);
  });
});

describe("robustness", () => {
  const ctx = { ownAddresses: OWN, now: NOW };
  it("returns null for junk and for calendars without an event", () => {
    expect(parseInvite("", ctx)).toBeNull();
    expect(parseInvite("hello world", ctx)).toBeNull();
    expect(parseInvite("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR", ctx)).toBeNull();
    expect(parseInvite("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR", ctx)).toBeNull();
  });
  it("accepts LF-only text, a BOM and a missing DTEND", () => {
    const ics = "﻿BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:x1\nDTSTART:20261201T100000Z\nSUMMARY:Quick\nEND:VEVENT\nEND:VCALENDAR\n";
    expect(parseInvite(ics, ctx)).toMatchObject({ uid: "x1", title: "Quick", start: utc(2026, 12, 1, 10), end: utc(2026, 12, 1, 10), method: "REQUEST" });
  });
  it("uses DURATION and defaults a bare all-day event to one day", () => {
    const dur = parseInvite("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:d\nDTSTART:20261201T100000Z\nDURATION:PT45M\nSUMMARY:D\nEND:VEVENT\nEND:VCALENDAR", ctx);
    expect(dur?.end).toBe(utc(2026, 12, 1, 10, 45));
    const day = parseInvite("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:e\nDTSTART;VALUE=DATE:20261201\nSUMMARY:E\nEND:VEVENT\nEND:VCALENDAR", ctx);
    expect(day).toMatchObject({ allDay: true, startDate: "2026-12-01", endDate: "2026-12-02" });
  });
  it("matches the user's alias case-insensitively", () => {
    const inv = parseInvite(fixture("google-weekly-meet.ics"), { ownAddresses: ["ME@Example.com"], now: NOW });
    expect(inv?.invitedAs?.address).toBe("me@example.com");
  });
  it("leaves invitedAs empty when the user is not a guest", () => {
    expect(parseInvite(fixture("google-weekly-meet.ics"), { ownAddresses: ["other@example.com"], now: NOW })?.invitedAs).toBeNull();
  });
});

describe("EXDATE and RDATE", () => {
  it("reads every listed date into the recurrence", () => {
    const ics = ["BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:ex@example.com", "DTSTAMP:20261001T000000Z",
      "DTSTART:20261006T160000Z", "DTEND:20261006T170000Z", "RRULE:FREQ=WEEKLY;BYDAY=TU", "EXDATE:20261013T160000Z,20261020T160000Z",
      "RDATE:20261015T160000Z", "SUMMARY:Sync", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
    const inv = parseInvite(ics, { ownAddresses: [], now: Date.UTC(2026, 9, 1) });
    expect(inv?.recurrence).toMatchObject({ hasExceptions: true, excluded: [Date.UTC(2026, 9, 13, 16), Date.UTC(2026, 9, 20, 16)], added: [Date.UTC(2026, 9, 15, 16)] });
  });
});
