import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { hasUid, parseDoc, render, sanitizeForImport, setPartstat, simpleEvents, stripMethod } from "./icsEdit";

const crlf = (s: string): string => s.replace(/\r?\n/g, "\r\n");
const ME = ["me@example.com"];

describe("round trip", () => {
  it("renders untouched documents byte for byte, with LF or CRLF and folded lines", () => {
    for (const ics of [fixture("google-weekly-meet.ics"), crlf(fixture("google-weekly-meet.ics")), fixture("folded-crlf.ics"), fixture("outlook-teams.ics")]) {
      expect(render(parseDoc(ics))).toBe(ics);
    }
  });
});

describe("setPartstat", () => {
  const base = crlf(fixture("google-weekly-meet.ics"));

  it("changes only the user's PARTSTAT, even when the ATTENDEE line is folded in the middle of the parameter", () => {
    const out = setPartstat(base, { recurrenceId: null, addresses: ME, partstat: "ACCEPTED" });
    expect(out.status).toBe("updated");
    if (out.status !== "updated") return;
    expect(out.previous).toBe("NEEDS-ACTION");
    const unfold = (t: string): string[] => t.replace(/\r\n /g, "").split("\r\n");
    const [was, now] = [unfold(base), unfold(out.ics)];
    expect(now).toHaveLength(was.length);
    const changed = now.filter((l, i) => l !== was[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("mailto:me@example.com");
    expect(out.ics.replace(/\r\n /g, "")).toContain("ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE;CN=me@example.com;X-NUM-GUESTS=0:mailto:me@example.com");
    expect(out.ics.endsWith("END:VCALENDAR\r\n")).toBe(base.endsWith("END:VCALENDAR\r\n"));
    expect(out.ics).toContain("PARTSTAT=TENTATIVE;RSVP=TRU\r\n E;CN=Mina Okafor"); // other attendees untouched
  });

  it("matches the address case-insensitively and accepts any of several own addresses", () => {
    const out = setPartstat(base, { recurrenceId: null, addresses: ["x@y.z", "ME@Example.com"], partstat: "DECLINED" });
    expect(out.status).toBe("updated");
  });

  it("adds PARTSTAT when the entry has none and reports unchanged when it already matches", () => {
    const bare = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:u1\nATTENDEE;CN=Me:mailto:me@example.com\nEND:VEVENT\nEND:VCALENDAR\n";
    const out = setPartstat(bare, { recurrenceId: null, addresses: ME, partstat: "TENTATIVE" });
    expect(out).toMatchObject({ status: "updated", ics: bare.replace("ATTENDEE;CN=Me:", "ATTENDEE;CN=Me;PARTSTAT=TENTATIVE:") });
    const again = setPartstat((out as { ics: string }).ics, { recurrenceId: null, addresses: ME, partstat: "TENTATIVE" });
    expect(again.status).toBe("unchanged");
  });

  it("reports when the user is not a guest", () => {
    expect(setPartstat(base, { recurrenceId: null, addresses: ["nobody@example.com"], partstat: "ACCEPTED" }).status).toBe("no-attendee");
  });

  it("edits an existing override for one occurrence and leaves the series master alone", () => {
    const ics = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:s1", "DTSTART;TZID=America/Los_Angeles:20261027T150000", "RRULE:FREQ=WEEKLY",
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:me@example.com", "END:VEVENT",
      "BEGIN:VEVENT", "UID:s1", "RECURRENCE-ID;TZID=America/Los_Angeles:20261103T150000", "DTSTART;TZID=America/Los_Angeles:20261103T163000",
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:me@example.com", "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n");
    // 2026-11-03 15:00 in Los Angeles (PST, UTC-8) is 23:00 UTC.
    const out = setPartstat(ics, { recurrenceId: "20261103T230000Z", addresses: ME, partstat: "DECLINED" });
    expect(out.status).toBe("updated");
    const text = (out as { ics: string }).ics;
    expect(text.match(/PARTSTAT=DECLINED/g)).toHaveLength(1);
    expect(text.indexOf("PARTSTAT=DECLINED")).toBeGreaterThan(text.indexOf("RECURRENCE-ID"));
  });

  it("adds an override cloned from the master when one occurrence has none, with RECURRENCE-ID, DTSTART and DTEND in the master's zone", () => {
    const out = setPartstat(base, { recurrenceId: "20261103T230000Z", addresses: ME, partstat: "ACCEPTED" });
    expect(out.status).toBe("updated");
    const text = (out as { ics: string }).ics;
    const events = text.split("BEGIN:VEVENT");
    expect(events).toHaveLength(3);
    const override = events[2]!;
    expect(override).toContain("RECURRENCE-ID;TZID=America/Los_Angeles:20261103T150000");
    expect(override).toContain("DTSTART;TZID=America/Los_Angeles:20261103T150000");
    expect(override).toContain("DTEND;TZID=America/Los_Angeles:20261103T160000");
    expect(override).not.toContain("RRULE");
    expect(override).toContain("UID:6mk3qd8c1p2v9rj4tb0h5s7xyz@google.com");
    expect(override.replace(/\r\n /g, "")).toContain("PARTSTAT=ACCEPTED;RSVP=TRUE;CN=me@example.com");
    expect(events[1]!.replace(/\r\n /g, "")).toContain("PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=me@example.com"); // master untouched
  });

  it("reports no-occurrence when a single event is asked for an occurrence that is not there", () => {
    const single = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nDTSTART:20261027T150000Z\nATTENDEE:mailto:me@example.com\nEND:VEVENT\nEND:VCALENDAR\n";
    expect(setPartstat(single, { recurrenceId: "20261104T150000Z", addresses: ME, partstat: "ACCEPTED" }).status).toBe("no-occurrence");
  });

  it("ignores ATTENDEE lines inside a nested VALARM", () => {
    const ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nBEGIN:VALARM\nATTENDEE:mailto:me@example.com\nEND:VALARM\nEND:VEVENT\nEND:VCALENDAR\n";
    expect(setPartstat(ics, { recurrenceId: null, addresses: ME, partstat: "ACCEPTED" }).status).toBe("no-attendee");
  });

  it("keeps non-ASCII text intact and folds a rewritten long line at 75 octets", () => {
    const long = `ATTENDEE;CN="Zoë Ångström-Müller-Hernández-Fernández de la Cruz";PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:me@example.com`;
    const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\n${long}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    const out = setPartstat(ics, { recurrenceId: null, addresses: ME, partstat: "ACCEPTED" }) as { ics: string };
    for (const line of out.ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(out.ics.replace(/\r\n /g, "")).toContain(long.replace("NEEDS-ACTION", "ACCEPTED"));
  });
});

describe("series answers and import sanitizing", () => {
  const base = crlf(fixture("google-weekly-meet.ics"));
  it("answering the whole series updates the master and every override that lists the user", () => {
    const master = /BEGIN:VEVENT[\s\S]*END:VEVENT\r\n/.exec(base)![0];
    const override = master.replace(/RRULE:[^\r]*\r\n/, "").replace("UID:", "RECURRENCE-ID:20261103T230000Z\r\nUID:");
    const out = setPartstat(base.replace("END:VCALENDAR", `${override}END:VCALENDAR`), { recurrenceId: null, addresses: ME, partstat: "DECLINED" });
    expect(out.status).toBe("updated");
    if (out.status !== "updated") return;
    expect(out.ics.replace(/\r\n /g, "").match(/PARTSTAT=DECLINED;RSVP=TRUE;CN=me@example.com/g)).toHaveLength(2);
  });

  it("sanitizeForImport drops alarms, attachments and vendor properties and nothing else", () => {
    const evil = base.replace("END:VEVENT", "ATTACH:https://evil.example/x\r\nX-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC\r\nBEGIN:VALARM\r\nACTION:EMAIL\r\nEND:VALARM\r\nEND:VEVENT");
    expect(sanitizeForImport(evil)).toBe(base);
  });
});

describe("helpers", () => {
  it("stripMethod removes only the iTIP METHOD line", () => {
    const ics = fixture("google-weekly-meet.ics");
    const out = stripMethod(ics);
    expect(out).not.toContain("METHOD:REQUEST");
    expect(out).toBe(ics.replace("METHOD:REQUEST\r\n", ""));
  });

  it("hasUid finds a UID even when the line is folded", () => {
    expect(hasUid(fixture("google-weekly-meet.ics"), "6mk3qd8c1p2v9rj4tb0h5s7xyz@google.com")).toBe(true);
    expect(hasUid("BEGIN:VEVENT\nUID:abc\n def\nEND:VEVENT", "abcdef")).toBe(true);
    expect(hasUid(fixture("google-weekly-meet.ics"), "other")).toBe(false);
  });

  it("simpleEvents reads title, times, status, transparency and the user's PARTSTAT", () => {
    const ics = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x", "SUMMARY:Lunch\\, with Sam", "DTSTART:20261027T170000Z", "DTEND:20261027T180000Z",
      "TRANSP:TRANSPARENT", "STATUS:CONFIRMED", "ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com", "END:VEVENT",
      "BEGIN:VEVENT", "UID:y", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261027", "END:VEVENT",
      "BEGIN:VEVENT", "UID:z", "DTSTART;TZID=America/New_York:20261027T090000", "DURATION:PT90M", "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n");
    const [a, b, c] = simpleEvents(ics, ME);
    expect(a).toMatchObject({ uid: "x", title: "Lunch, with Sam", start: Date.UTC(2026, 9, 27, 17), end: Date.UTC(2026, 9, 27, 18), transparent: true, selfDeclined: true, status: "CONFIRMED" });
    expect(b).toMatchObject({ uid: "y", allDay: true, start: Date.UTC(2026, 9, 27), end: Date.UTC(2026, 9, 28) });
    expect(c).toMatchObject({ start: Date.UTC(2026, 9, 27, 13), end: Date.UTC(2026, 9, 27, 14, 30), title: "(No title)" });
  });
});
