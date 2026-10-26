import { describe, expect, it } from "vitest";
import { FlintError } from "../src/types";
import { fixture } from "../src/calendar/fixtures";
import { GOOGLE_CALENDAR_SCOPE } from "../src/mail/google-oauth";
import type { GoogleRespondInput } from "../src/calendar/contracts";
import { addICloud, eventFile, googleTokens, NOW, receiveInvite, rig, UID, unfold } from "./calendar-rig";

const DAY = 86_400_000;
/** The fixture invitation is 2026-10-27 15:00-16:00 America/Los_Angeles (PDT). */
const START = Date.UTC(2026, 9, 27, 22);
const END = START + 3_600_000;

async function ready(o: Parameters<typeof rig>[0] = {}, opts: { inCalendar?: boolean | "other-calendar"; extra?: string[] } = {}) {
  // The server knows me@example.com as one of the account's addresses unless a test says otherwise.
  const r = rig({ addresses: ["appleid@icloud.com", "me@example.com"], ...o });
  const calendar = await addICloud(r, opts.extra ?? []);
  const received = receiveInvite(r);
  let href = "";
  if (opts.inCalendar !== false) href = r.fake.add(opts.inCalendar === "other-calendar" ? "home" : "work", "design", eventFile());
  r.fake.log.length = 0;
  return { ...r, calendar, ...received, href };
}

describe("routing", () => {
  it("answers by mail until a calendar covers the invited address, then through CalDAV, then by mail again", async () => {
    const r = rig();
    const { messageId } = receiveInvite(r);
    expect((await r.api.getInvite(messageId))?.rsvpVia).toBe("imip");
    const c = await addICloud(r);
    expect((await r.api.getInvite(messageId))?.rsvpVia).toBe("caldav");
    await r.api.removeCalendarAccount(c.id);
    expect((await r.api.getInvite(messageId))?.rsvpVia).toBe("imip");
  });

  it("does not use a calendar that covers a different address", async () => {
    const r = rig();
    const { messageId } = receiveInvite(r);
    await addICloud(r, []); // covers appleid@icloud.com only
    expect((await r.api.getInvite(messageId))?.rsvpVia).toBe("imip");
    r.fake.log.length = 0;
    await r.api.rsvp(messageId, "accepted");
    expect(r.sent).toHaveLength(1);
    expect(r.fake.log).toHaveLength(0);
  });

  it("matches the invited address case-insensitively and through the mail account's aliases", async () => {
    const r = rig();
    r.store.updateAccount(r.seed.account.id, { aliases: ["Neel@Xanom.co"] });
    const { messageId } = receiveInvite(r, { ics: fixture("google-weekly-meet.ics").replaceAll("me@example.com", "Neel@Xanom.CO"), ownAddresses: ["neel@xanom.co"] });
    await addICloud(r, ["NEEL@xanom.co"]);
    expect((await r.api.getInvite(messageId))?.rsvpVia).toBe("caldav");
  });

  it("keeps using the Gmail sign-in's own calendar scope for a Gmail mail account", async () => {
    const r = rig();
    const gmail = r.store.createAccount({
      email: "me@gmail.com", name: "Me", provider: "gmail", authKind: "oauth_google", username: "me@gmail.com",
      imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true,
    });
    r.store.updateAccount(gmail.id, { calendarScope: true });
    await r.secrets.set(`account:${gmail.id}`, googleTokens());
    const inbox = r.store.upsertFolder(gmail.id, { path: "INBOX", role: "inbox" });
    const { msg, person } = await import("../src/store/testkit");
    const [o] = r.store.ingestMessages(gmail.id, inbox.id, [msg({ uid: 9, from: [person("Carla", "carla@northwind.example")], hasAttachments: true })]);
    const ics = fixture("google-weekly-meet.ics").replaceAll("me@example.com", "me@gmail.com");
    const { parseInvite } = await import("../src/calendar/parse");
    r.store.saveInvite({ messageId: o!.messageRowId, accountId: gmail.id, invite: parseInvite(ics, { ownAddresses: ["me@gmail.com"], now: NOW })!, ics, parserVersion: 99, parsedAt: NOW });
    await r.api.addCalDavAccount({ preset: "icloud", username: r.username, password: "app-pass", extraAddresses: ["me@gmail.com"] });
    r.fake.log.length = 0;
    expect((await r.api.getInvite(o!.messageRowId))?.rsvpVia).toBe("google-calendar");
    await r.api.rsvp(o!.messageRowId, "accepted");
    expect(r.google.respond).toHaveBeenCalled();
    expect(r.fake.log).toHaveLength(0);
  });
});

describe("RSVP through CalDAV", () => {
  it("updates only the user's PARTSTAT with If-Match, and lets the scheduling server tell the organizer (no mail)", async () => {
    const r = await ready();
    const before = r.fake.resources.get(r.href)!;
    const out = await r.api.rsvp(r.messageId, "accepted");
    expect(out.yourResponse).toBe("accepted");
    const put = r.fake.log.find((l) => l.method === "PUT")!;
    expect(put.headers["if-match"]).toBe(before.etag);
    expect(new URL(put.url).pathname).toBe(r.href);
    const was = unfold(before.ics);
    const now = unfold(put.body);
    expect(now).toHaveLength(was.length);
    const changed = now.filter((l, i) => l !== was[i]);
    expect(changed).toEqual(["ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE;CN=me@example.com;X-NUM-GUESTS=0:mailto:me@example.com"]);
    expect(r.fake.resources.get(r.href)!.ics).toBe(put.body);
    expect(r.fake.scheduled).toEqual([{ uid: UID, partstat: "ACCEPTED", href: r.href }]);
    expect(r.sent).toHaveLength(0);
    expect(r.store.getResponse(r.seed.account.id, UID, "")).toMatchObject({ response: "accepted", via: "caldav" });
    expect(r.events.some((e) => e.type === "mail_changed")).toBe(true);
  });

  it("maps each answer to its PARTSTAT", async () => {
    for (const [answer, word] of [["tentative", "TENTATIVE"], ["declined", "DECLINED"]] as const) {
      const r = await ready();
      await r.api.rsvp(r.messageId, answer);
      expect(r.fake.resources.get(r.href)!.ics.replace(/\r\n /g, "")).toContain(`PARTSTAT=${word};RSVP=TRUE;CN=me@example.com`);
    }
  });

  it("also sends the iMIP reply when the address is only one the user added by hand, which the server does not treat as theirs", async () => {
    const r = await ready({ addresses: ["appleid@icloud.com"] }, { extra: ["me@example.com"] });
    expect(r.calendar.scheduling).toBe(true);
    await r.api.rsvp(r.messageId, "accepted");
    expect(r.fake.log.some((l) => l.method === "PUT")).toBe(true);
    expect(r.fake.scheduled).toHaveLength(0);
    expect(r.sent).toHaveLength(1);
  });

  it("also sends the iMIP reply when the server does not do scheduling", async () => {
    const r = await ready({ scheduling: false });
    expect(r.calendar.scheduling).toBe(false);
    await r.api.rsvp(r.messageId, "accepted");
    expect(r.fake.log.some((l) => l.method === "PUT")).toBe(true);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ to: { address: "carla@northwind.example" }, subject: "Accepted: Design sync" });
    expect(r.sent[0]!.ics).toContain("METHOD:REPLY");
    expect(r.store.getResponse(r.seed.account.id, UID, "")).toMatchObject({ via: "caldav" });
  });

  it("also mails the reply when the answer carries a note, because the server's reply cannot", async () => {
    const r = await ready();
    await r.api.rsvp(r.messageId, "tentative", "Might be late");
    expect(r.fake.scheduled).toHaveLength(1);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.ics).toContain("COMMENT:Might be late");
  });

  it("finds the event in another calendar of the account", async () => {
    const r = await ready({}, { inCalendar: "other-calendar" });
    await r.api.rsvp(r.messageId, "accepted");
    const put = r.fake.log.find((l) => l.method === "PUT")!;
    expect(new URL(put.url).pathname).toContain("/home/");
    expect(r.fake.log.filter((l) => l.method === "REPORT")).toHaveLength(2);
  });

  it("adds the event from the invitation (without METHOD) when the calendar does not have it yet", async () => {
    const r = await ready({}, { inCalendar: false });
    await r.api.rsvp(r.messageId, "accepted");
    const put = r.fake.log.find((l) => l.method === "PUT")!;
    expect(put.headers["if-none-match"]).toBe("*");
    expect(put.headers["if-match"]).toBeUndefined();
    expect(put.url).toContain("/work/"); // the account's default calendar
    expect(put.url).toContain(`${UID.replace("@", "@")}.ics`);
    expect(put.body).not.toContain("METHOD:");
    expect(put.body.replace(/\r\n /g, "")).toContain("PARTSTAT=ACCEPTED;RSVP=TRUE;CN=me@example.com");
    expect(put.body).toContain("ORGANIZER;CN=Carla Ortiz:mailto:carla@northwind.example");
    expect(r.fake.resources.size).toBe(1);
    expect(r.sent).toHaveLength(0);
  });

  it("answers one occurrence of a series by adding an override to the resource", async () => {
    const r = await ready();
    const mk = (await import("../src/calendar/parse")).parseInvite;
    // A single-occurrence update for the third Tuesday of the series.
    const instance = fixture("google-instance-update.ics").replaceAll("me@example.com", "me@example.com");
    const stored = mk(instance, { ownAddresses: ["me@example.com"], now: NOW })!;
    expect(stored.recurrenceId).toBe("20261103T230000Z");
    r.fake.resources.get(r.href)!.ics = eventFile().replace("6mk3qd8c1p2v9rj4tb0h5s7xyz@google.com", stored.uid);
    const second = receiveInvite(r, { ics: instance, uid: 6 });
    await r.api.rsvp(second.messageId, "declined");
    const text = r.fake.resources.get(r.href)!.ics;
    expect(text.split("BEGIN:VEVENT")).toHaveLength(3);
    expect(text).toContain("RECURRENCE-ID;TZID=America/Los_Angeles:20261103T150000");
    expect(text.replace(/\r\n /g, "")).toContain("PARTSTAT=DECLINED");
  });

  it("re-reads and retries once when someone else changed the event (412), keeping their change", async () => {
    const r = await ready();
    r.fake.beforeNextPut = () => {
      const res = r.fake.resources.get(r.href)!;
      res.ics = res.ics.replace("SEQUENCE:0", "SEQUENCE:0\r\nX-SERVER-EDIT:1");
      res.etag = '"server-changed"';
    };
    await r.api.rsvp(r.messageId, "accepted");
    const puts = r.fake.log.filter((l) => l.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[0]!.headers["if-match"]).not.toBe('"server-changed"');
    expect(puts[1]!.headers["if-match"]).toBe('"server-changed"');
    const final = r.fake.resources.get(r.href)!.ics;
    expect(final).toContain("X-SERVER-EDIT:1");
    expect(final.replace(/\r\n /g, "")).toContain("PARTSTAT=ACCEPTED");
  });

  it("gives up with a clear error when the event keeps changing, and records nothing", async () => {
    const r = await ready();
    let n = 0;
    const churn = (): void => {
      n++;
      r.fake.resources.get(r.href)!.etag = `"churn-${n}"`;
      r.fake.beforeNextPut = churn;
    };
    r.fake.beforeNextPut = churn;
    await expect(r.api.rsvp(r.messageId, "accepted")).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("changed") });
    expect(r.store.getResponse(r.seed.account.id, UID, "")).toBeNull();
    expect(r.sent).toHaveLength(0);
  });

  it("does nothing on the server when the event already has that answer", async () => {
    const r = await ready();
    await r.api.rsvp(r.messageId, "accepted");
    r.fake.log.length = 0;
    await r.api.rsvp(r.messageId, "declined"); // a different answer is a new PUT
    expect(r.fake.log.filter((l) => l.method === "PUT")).toHaveLength(1);
    r.fake.log.length = 0;
    r.store.setResponse({ accountId: r.seed.account.id, uid: UID, recurrenceId: "", response: "tentative", note: null, via: "caldav", sequence: 0, respondedAt: NOW });
    await r.api.rsvp(r.messageId, "declined"); // the server copy already says DECLINED
    expect(r.fake.log.filter((l) => l.method === "PUT")).toHaveLength(0);
    expect(r.store.getResponse(r.seed.account.id, UID, "")).toMatchObject({ response: "declined" });
  });

  it("falls back to the iMIP reply when the calendar's copy does not list the user", async () => {
    const r = await ready();
    r.fake.resources.get(r.href)!.ics = eventFile().replaceAll("me@example.com", "someone.else@example.com");
    await r.api.rsvp(r.messageId, "accepted");
    expect(r.fake.log.some((l) => l.method === "PUT")).toBe(false);
    expect(r.sent).toHaveLength(1);
    expect(r.store.getResponse(r.seed.account.id, UID, "")).toMatchObject({ via: "imip" });
  });

  it("flags the account for sign-in on a rejected password and answers by mail instead", async () => {
    const r = await ready();
    await r.secrets.set(`calendar:${r.calendar.id}`, JSON.stringify({ password: "revoked" }));
    await r.api.rsvp(r.messageId, "accepted");
    expect((await r.api.listCalendarAccounts())[0]).toMatchObject({ status: "needs-signin", statusMessage: expect.stringContaining("password") });
    expect(r.sent).toHaveLength(1);
    expect(r.store.getResponse(r.seed.account.id, UID, "")).toMatchObject({ response: "accepted", via: "imip" });
    // Fixing the password (adding the account again) clears the flag.
    await addICloud(r);
    expect((await r.api.listCalendarAccounts())[0]).toMatchObject({ status: "ok", statusMessage: null });
  });

  it("answers by mail when the calendar server is down", async () => {
    const r = await ready();
    r.fake.fetch = async () => { throw new Error("offline"); };
    await r.api.rsvp(r.messageId, "accepted");
    expect(r.sent).toHaveLength(1);
    expect(r.store.getResponse(r.seed.account.id, UID, "")).toMatchObject({ via: "imip" });
  });

  it("answers by mail when the calendar is read-only (403 on PUT)", async () => {
    const r = await ready();
    r.fake.override = (m) => (m === "PUT" ? { status: 403, headers: { get: () => null }, text: async () => "" } : null);
    await r.api.rsvp(r.messageId, "accepted");
    expect(r.sent).toHaveLength(1);
    expect(r.store.getResponse(r.seed.account.id, UID, "")).toMatchObject({ via: "imip" });
  });

  it("shows the calendar error when the outage leaves nothing to mail", async () => {
    const r = await ready();
    r.store.updateAccount(r.seed.account.id, { aliases: ["carla@northwind.example"] }); // the organizer is the user
    r.fake.fetch = async () => { throw new Error("offline"); };
    await expect(r.api.rsvp(r.messageId, "accepted")).rejects.toMatchObject({ code: "network" });
    expect(r.sent).toHaveLength(0);
  });

  it("an explicit-scheduling server (outbox, no calendar-auto-schedule) still gets the iMIP reply", async () => {
    const r = await ready({ autoSchedule: false });
    expect(r.calendar.scheduling).toBe(false);
    await r.api.rsvp(r.messageId, "accepted");
    expect(r.sent).toHaveLength(1);
  });

  it("updates every VEVENT of the series (moved instances too) when the whole series is answered", async () => {
    const r = await ready();
    const base = r.fake.resources.get(r.href)!.ics;
    const master = /BEGIN:VEVENT[\s\S]*END:VEVENT\r\n/.exec(base)![0];
    const override = master.replace(/RRULE:[^\r]*\r\n/, "").replace("UID:", "RECURRENCE-ID:20261103T230000Z\r\nUID:");
    r.fake.resources.get(r.href)!.ics = base.replace("END:VCALENDAR", `${override}END:VCALENDAR`);
    await r.api.rsvp(r.messageId, "accepted");
    const text = r.fake.resources.get(r.href)!.ics.replace(/\r\n /g, "");
    expect(text.match(/PARTSTAT=ACCEPTED;RSVP=TRUE;CN=me@example.com/g)).toHaveLength(2);
  });

  it("creates a missing event inside the calendar even when its href has no trailing slash, without alarms or attachments", async () => {
    const r = await ready({}, { inCalendar: false });
    const evil = fixture("google-weekly-meet.ics").replace("END:VEVENT", "ATTACH:https://evil.example/x.exe\r\nX-APPLE-DEFAULT-ALARM:TRUE\r\nBEGIN:VALARM\r\nACTION:PROCEDURE\r\nATTACH:file:///bin/sh\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT");
    const second = receiveInvite(r, { ics: evil, uid: 7 });
    r.store.updateCalendarAccountRow(r.calendar.id, { calendars: [{ url: r.fake.calendarHref("work").replace(/\/$/, ""), name: "Work" }], defaultCalendarUrl: r.fake.calendarHref("work").replace(/\/$/, ""), defaultCalendarName: "Work" });
    await r.api.rsvp(second.messageId, "accepted");
    const put = r.fake.log.find((l) => l.method === "PUT")!;
    expect(new URL(put.url).pathname).toMatch(/\/work\/[^/]+\.ics$/);
    expect(put.body).not.toMatch(/VALARM|ATTACH|X-APPLE|evil\.example/);
    expect(put.body).toContain("PARTSTAT=ACCEPTED");
  });
});

describe("RSVP through a Google calendar account on an IMAP mailbox", () => {
  async function google(calls: GoogleRespondInput[]) {
    const r = rig({ googleCalls: calls });
    (r.ctx.invites as { googleAuth?: unknown }).googleAuth = async () => ({
      email: "neel@xanom.co", name: "Neel", accessToken: "GAT", refreshToken: "GRT", expiresAt: NOW + 3_600_000, scope: `openid email profile ${GOOGLE_CALENDAR_SCOPE}`,
    });
    const { messageId } = receiveInvite(r, { ics: fixture("google-weekly-meet.ics").replaceAll("me@example.com", "neel@xanom.co"), ownAddresses: ["neel@xanom.co"] });
    r.store.updateAccount(r.seed.account.id, { aliases: ["neel@xanom.co"] });
    const cal = await r.api.addGoogleCalendarAccount({ loginHint: "neel@xanom.co" });
    return { ...r, messageId, cal };
  }

  it("uses the Calendar API with the calendar account's token and sends no mail", async () => {
    const calls: GoogleRespondInput[] = [];
    const r = await google(calls);
    expect((await r.api.getInvite(r.messageId))?.rsvpVia).toBe("google-calendar");
    await r.api.rsvp(r.messageId, "accepted", "On my way");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ accessToken: "GAT", uid: UID, response: "accepted", comment: "On my way" });
    expect(calls[0]!.selfAddresses).toContain("neel@xanom.co");
    expect(r.sent).toHaveLength(0);
    expect(r.store.getResponse(r.seed.account.id, UID, "")).toMatchObject({ via: "google-calendar" });
  });

  it("refreshes an expiring token first", async () => {
    const calls: GoogleRespondInput[] = [];
    const r = await google(calls);
    await r.secrets.set(`calendar:${r.cal.id}`, googleTokens({ expiresAt: NOW + 1000 }));
    await r.api.rsvp(r.messageId, "declined");
    expect(r.tokenCalls).toHaveLength(1);
    expect(calls[0]!.accessToken).toBe("FRESH");
  });

  it("falls back to the iMIP reply when the event is not on that Google calendar", async () => {
    const calls: GoogleRespondInput[] = [];
    const r = await google(calls);
    (r.google.respond as unknown as { mockRejectedValueOnce(e: unknown): void }).mockRejectedValueOnce(new FlintError("not_found", "not on this calendar"));
    await r.api.rsvp(r.messageId, "accepted");
    expect(r.sent).toHaveLength(1);
  });
});

describe("conflicts", () => {
  const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ev = (uid: string, from: number, to: number, extra = ""): string =>
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${uid}\r\nDTSTART:${stamp(from)}\r\nDTEND:${stamp(to)}\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;

  it("is free when the default calendar has nothing at that time", async () => {
    const r = await ready();
    r.fake.add("work", "far", ev("far", START + DAY, END + DAY));
    r.fake.add("home", "elsewhere", ev("elsewhere", START, END)); // other calendars are not consulted
    expect(await r.api.inviteConflicts(r.messageId)).toEqual({ status: "free", checkedAt: NOW });
    const report = r.fake.log.find((l) => l.method === "REPORT")!;
    expect(report.url).toContain("/work/");
    expect(report.body).toContain(`<c:time-range start="${stamp(START)}" end="${stamp(END)}"/>`);
  });

  it("lists overlapping events but not back-to-back, cancelled, free, declined or the event itself", async () => {
    const r = await ready();
    r.fake.add("work", "clash", ev("clash", START + 30 * 60_000, START + 90 * 60_000));
    r.fake.add("work", "before", ev("before", START - 3_600_000, START));
    r.fake.add("work", "cancelled", ev("cancelled", START, END, "STATUS:CANCELLED\r\n"));
    r.fake.add("work", "free", ev("free", START, END, "TRANSP:TRANSPARENT\r\n"));
    r.fake.add("work", "declined", ev("declined", START, END, "ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com\r\n"));
    r.fake.add("work", "self", ev(UID, START, END));
    const result = await r.api.inviteConflicts(r.messageId);
    expect(result).toEqual({ status: "conflict", checkedAt: NOW, events: [{ title: "clash", start: START + 30 * 60_000, end: START + 90 * 60_000, allDay: false }] });
  });

  it("is unknown (not free) when the server returns an unexpanded series master", async () => {
    const r = await ready();
    r.fake.add("work", "weekly", ev("weekly", START, END, "RRULE:FREQ=WEEKLY\r\n"));
    expect(await r.api.inviteConflicts(r.messageId)).toMatchObject({ status: "unknown", reason: "error", message: expect.stringContaining("repeating") });
  });

  it("caches the answer briefly", async () => {
    const r = await ready();
    await r.api.inviteConflicts(r.messageId);
    const n = r.fake.log.length;
    await r.api.inviteConflicts(r.messageId);
    expect(r.fake.log).toHaveLength(n);
  });

  it("is unknown with a reason when the server fails, rejects the password, or no calendar covers the address", async () => {
    const r = await ready();
    r.fake.fetch = async () => { throw new Error("down"); };
    expect(await r.api.inviteConflicts(r.messageId)).toMatchObject({ status: "unknown", reason: "error", message: expect.stringContaining("Could not reach") });

    const bad = await ready();
    await bad.secrets.set(`calendar:${bad.calendar.id}`, JSON.stringify({ password: "revoked" }));
    expect(await bad.api.inviteConflicts(bad.messageId)).toMatchObject({ status: "unknown", reason: "no-scope" });
    expect((await bad.api.listCalendarAccounts())[0]!.status).toBe("needs-signin");

    const none = rig();
    const { messageId } = receiveInvite(none);
    expect(await none.api.inviteConflicts(messageId)).toEqual({ status: "unknown", reason: "no-calendar" });
  });

  it("is unknown for a Gmail sign-in without the scope and no covering calendar, and for all-day events", async () => {
    const r = rig();
    const gmail = r.store.createAccount({
      email: "me@gmail.com", name: "Me", provider: "gmail", authKind: "oauth_google", username: "me@gmail.com",
      imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true,
    });
    const inbox = r.store.upsertFolder(gmail.id, { path: "INBOX", role: "inbox" });
    const { msg, person } = await import("../src/store/testkit");
    const { parseInvite } = await import("../src/calendar/parse");
    const [o] = r.store.ingestMessages(gmail.id, inbox.id, [msg({ uid: 9, from: [person("Carla", "carla@northwind.example")], hasAttachments: true })]);
    const ics = fixture("google-weekly-meet.ics").replaceAll("me@example.com", "me@gmail.com");
    r.store.saveInvite({ messageId: o!.messageRowId, accountId: gmail.id, invite: parseInvite(ics, { ownAddresses: ["me@gmail.com"], now: NOW })!, ics, parserVersion: 99, parsedAt: NOW });
    expect((await r.api.getInvite(o!.messageRowId))?.rsvpVia).toBe("google-needs-scope");
    expect(await r.api.inviteConflicts(o!.messageRowId)).toEqual({ status: "unknown", reason: "no-scope" });
    // An iCloud calendar covering the address takes over from the Connect Google Calendar prompt.
    await r.api.addCalDavAccount({ preset: "icloud", username: r.username, password: "app-pass", extraAddresses: ["me@gmail.com"] });
    expect((await r.api.getInvite(o!.messageRowId))?.rsvpVia).toBe("caldav");
    expect((await r.api.inviteConflicts(o!.messageRowId)).status).toBe("free");
  });

  it("checks a Google calendar account through the Calendar API", async () => {
    const r = rig({ listEvents: async () => [{ id: "g1", iCalUID: "other@google.com", title: "Standup", start: START, end: END, allDay: false, selfResponse: "accepted", htmlLink: null }] });
    (r.ctx.invites as { googleAuth?: unknown }).googleAuth = async () => ({
      email: "neel@xanom.co", name: "Neel", accessToken: "GAT", refreshToken: "GRT", expiresAt: NOW + 3_600_000, scope: `openid email profile ${GOOGLE_CALENDAR_SCOPE}`,
    });
    await r.api.addGoogleCalendarAccount({ extraAddresses: ["me@example.com"] });
    const { messageId } = receiveInvite(r);
    expect(await r.api.inviteConflicts(messageId)).toMatchObject({ status: "conflict", events: [{ title: "Standup" }] });
  });
});
