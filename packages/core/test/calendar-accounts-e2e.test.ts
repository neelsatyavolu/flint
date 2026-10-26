// End to end: a Proton-style IMAP mailbox receives an invitation; the answer goes wherever the covering calendar account says.
import { describe, expect, it } from "vitest";
import { fixture } from "../src/calendar/fixtures";
import { GOOGLE_CALENDAR_SCOPE } from "../src/mail/google-oauth";
import { addICloud, eventFile, NOW, receiveInvite, rig, UID, unfold } from "./calendar-rig";

const ADDRESS = "neel@example.org";
const invite = () => fixture("google-weekly-meet.ics").replaceAll("me@example.com", ADDRESS);

type ApiCall = { method: string; url: URL; body: unknown };
const attendees = [
  { email: "carla@northwind.example", organizer: true, responseStatus: "accepted" },
  { email: ADDRESS, self: true, responseStatus: "needsAction" },
];

describe("calendar accounts, end to end", () => {
  it("IMAP mailbox + Google calendar-only account: patches through the Calendar API, sends no mail", async () => {
    const calls: ApiCall[] = [];
    const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    const r = rig({
      mailAddress: "neel@xanom.co",
      calendarApi: (url, init) => {
        const call = { method: init?.method ?? "GET", url: new URL(url), body: init?.body ? JSON.parse(init.body) : undefined };
        calls.push(call);
        return call.method === "GET" ? reply({ items: [{ id: "ev1", iCalUID: UID, etag: '"e1"', attendees }] }) : reply({ id: "ev1", htmlLink: null });
      },
    });
    (r.ctx.invites as { googleAuth?: unknown }).googleAuth = async () => ({
      email: ADDRESS, name: "Neel", accessToken: "GAT", refreshToken: "GRT", expiresAt: NOW + 3_600_000, scope: `openid email profile ${GOOGLE_CALENDAR_SCOPE}`,
    });
    const { messageId } = receiveInvite(r, { ics: invite(), ownAddresses: [ADDRESS] });
    expect((await r.api.getInvite(messageId))?.rsvpVia).toBe("imip");
    const cal = await r.api.addGoogleCalendarAccount({ loginHint: ADDRESS });
    expect(cal.kind).toBe("google");
    expect(JSON.stringify(r.store.listCalendarAccountRows())).not.toContain("GRT");
    expect((await r.api.getInvite(messageId))?.rsvpVia).toBe("google-calendar");

    const out = await r.api.rsvp(messageId, "accepted");
    expect(out.yourResponse).toBe("accepted");
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url.searchParams.get("sendUpdates")).toBe("all");
    expect((patch.body as { attendees: { email: string; responseStatus: string }[] }).attendees.find((a) => a.email === ADDRESS)?.responseStatus).toBe("accepted");
    expect(r.sent).toHaveLength(0);
    expect(r.fake.log).toHaveLength(0);
  });

  it("IMAP mailbox + iCloud CalDAV with scheduling: updates PARTSTAT with a PUT, the server notifies the organizer", async () => {
    const r = rig({ addresses: ["appleid@icloud.com", ADDRESS] });
    await addICloud(r, []);
    const { messageId } = receiveInvite(r, { ics: invite(), ownAddresses: [ADDRESS] });
    const href = r.fake.add("work", "design", eventFile().replaceAll("me@example.com", ADDRESS));
    const before = r.fake.resources.get(href)!;
    r.fake.log.length = 0;
    expect((await r.api.getInvite(messageId))?.rsvpVia).toBe("caldav");

    await r.api.rsvp(messageId, "accepted");
    const put = r.fake.log.find((l) => l.method === "PUT")!;
    expect(put.headers["if-match"]).toBe(before.etag);
    const was = unfold(before.ics);
    expect(unfold(put.body).filter((l, i) => l !== was[i])).toHaveLength(1);
    expect(put.body).toContain("PARTSTAT=ACCEPTED");
    expect(r.fake.scheduled).toEqual([{ uid: UID, partstat: "ACCEPTED", href }]);
    expect(r.sent).toHaveLength(0);
  });

  it("IMAP mailbox with no calendar account: sends the iMIP reply", async () => {
    const r = rig();
    const { messageId } = receiveInvite(r);
    expect((await r.api.getInvite(messageId))?.rsvpVia).toBe("imip");
    await r.api.rsvp(messageId, "accepted");
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ to: { address: "carla@northwind.example" } });
    expect(r.sent[0]!.ics).toContain("METHOD:REPLY");
    expect(r.fake.log).toHaveLength(0);
  });
});
