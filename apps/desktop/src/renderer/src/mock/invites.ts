import type { Address, Invite, InviteAttendee, InviteChip, InviteConflicts, InviteListItem, InviteResponse, MessageRowId, RsvpResponse } from "@flint/core";
import { ME, PEOPLE as P } from "./people";
import { DAY, type SeedThread } from "./seedTypes";
import type { MockState } from "./state";

// Demo calendar invitations for the preview: a Google Meet weekly invite, an updated invite with a new time, a cancellation,
// a Zoom invite from an Outlook organizer, and a reply. All names and times are invented; times are relative to "now".

const MIN = 60_000;

/** Local-time slot `days` from now at hour:minute, `minutes` long. */
function slot(now: number, days: number, hour: number, minutes: number, minute = 0): { start: number; end: number } {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return { start: d.getTime(), end: d.getTime() + minutes * MIN };
}

const att = (a: Address, response: InviteResponse, role: InviteAttendee["role"] = "required", isYou = false): InviteAttendee =>
  ({ name: a.name, address: a.address.toLowerCase(), response, role, rsvp: true, isYou });

const dayTime = (ts: number): string => new Date(ts).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

/** An Invite with the boring fields filled in. */
function invite(o: Partial<Invite> & Pick<Invite, "uid" | "title" | "start" | "end">): Invite {
  return {
    method: "REQUEST", sequence: 0, recurrenceId: null, description: null, allDay: false, startDate: null, endDate: null, timeZone: "America/Los_Angeles",
    recurrence: null, location: null, url: null, conference: null, organizer: null, attendees: [], invitedAs: null, dtstamp: o.start - 3 * DAY * MIN,
    source: "google", googleEventUrl: null, reply: null, state: "new", yourResponse: "needs-action", respondedAt: null, yourNote: null, changes: [],
    newerMessageId: null, rsvpVia: "imip", ...o,
  };
}

const googleBoilerplate = (title: string, when: string, who: string): string =>
  `<div style="font-family:Arial,sans-serif;color:#202124"><h2 style="font-weight:400">${title}</h2><p>${when}</p><p>Organizer: ${who}</p>` +
  `<p><a href="https://meet.example/abc-defg-hij">Join with Google Meet</a></p><p>Reply for Alex Rivera: <a href="#">Yes</a> - <a href="#">No</a> - <a href="#">Maybe</a> - <a href="#">More options</a></p>` +
  `<hr><p style="color:#5f6368;font-size:12px">Invitation from Google Calendar. You are receiving this email because you are an attendee on the event. To stop receiving these emails, change your notification settings for this calendar. Forwarding this invitation could allow any recipient to send a response to the organizer.</p></div>`;

const GUESTS: Address[] = [P.priya, P.tomas, P.sofia, P.meiling, P.daniel, P.omar];

/** Seed threads. Each message that carries an invite builds it from `now` when the thread is built. */
export const INVITE_THREADS: SeedThread[] = [
  {
    // Weekly Google Meet invite on an account that has not connected Google Calendar yet.
    acct: "gmail", subject: "Invitation: Design sync @ Weekly on Tuesday 3pm (PT)", unread: true,
    msgs: [{
      from: P.priya, to: [{ name: "Alex Rivera", address: ME.gmail }], minsAgo: 95,
      text: "Priya Raman invited you to Design sync. Weekly on Tuesday from 3pm to 3:45pm (Pacific Time). Join with Google Meet: https://meet.example/abc-defg-hij",
      html: googleBoilerplate("Design sync", "Weekly on Tuesday, 3pm - 3:45pm (Pacific Time)", "Priya Raman"),
      invite: (now) => {
        const t = slot(now, 2, 15, 45);
        return invite({
          uid: "design-sync-weekly@google.com", ...t, title: "Design sync",
          description: "Walk through open design questions and decide what ships this week. Add items to the agenda doc before the call.",
          recurrence: { summary: "Weekly on Tuesday until Dec 22", rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261222T235959Z", hasExceptions: false },
          conference: { kind: "meet", url: "https://meet.example/abc-defg-hij", label: "Google Meet", code: null, phone: null },
          organizer: P.priya, googleEventUrl: "https://calendar.example/event?eid=designsync",
          attendees: [att(P.priya, "accepted", "chair"), att({ name: "Alex Rivera", address: ME.gmail }, "needs-action", "required", true), ...GUESTS.slice(1).map((g, i) => att(g, (["accepted", "tentative", "needs-action", "declined", "accepted"] as const)[i]!, i === 4 ? "optional" : "required"))],
          invitedAs: { address: ME.gmail, role: "required", rsvp: true }, rsvpVia: "google-needs-scope",
        });
      },
    }],
  },
  {
    // An updated invite: the first message is superseded by the second (new time and room). IMAP account, so RSVP goes by mail.
    acct: "orbit", subject: "Updated invitation: Brand review @ Thu 11am", unread: true,
    msgs: [
      {
        from: P.nadia, to: [{ name: "Alex Rivera", address: ME.orbit }], minsAgo: 2 * DAY, seen: true,
        text: "Nadia Nikolaeva invited you to Brand review. Thursday 10:00 - 11:00 in the Atlas room.",
        invite: (now) => {
          const t = slot(now, 3, 10, 60);
          return invite({
            uid: "brand-review-7731@studio-orbit.com", sequence: 0, ...t, title: "Brand review", location: "Atlas room, Studio Orbit, 214 Mission St, San Francisco",
            organizer: P.nadia, timeZone: "America/Los_Angeles", source: "other",
            attendees: [att(P.nadia, "accepted", "chair"), att({ name: "Alex Rivera", address: ME.orbit }, "accepted", "required", true), att(P.hiro, "accepted")],
            invitedAs: { address: ME.orbit, role: "required", rsvp: true }, state: "superseded", yourResponse: "accepted", respondedAt: now - 2 * DAY * MIN + 20 * MIN, rsvpVia: "none",
          });
        },
      },
      {
        from: P.nadia, to: [{ name: "Alex Rivera", address: ME.orbit }], minsAgo: 40,
        text: "Nadia Nikolaeva updated Brand review. It now starts at 11:00 in the Harbor room.",
        invite: (now) => {
          const t = slot(now, 3, 11, 60, 30);
          return invite({
            uid: "brand-review-7731@studio-orbit.com", sequence: 1, ...t, title: "Brand review", location: "Harbor room, Studio Orbit, 214 Mission St, San Francisco",
            organizer: P.nadia, timeZone: "America/Los_Angeles", source: "other",
            attendees: [att(P.nadia, "accepted", "chair"), att({ name: "Alex Rivera", address: ME.orbit }, "needs-action", "required", true), att(P.hiro, "accepted")],
            invitedAs: { address: ME.orbit, role: "required", rsvp: true }, state: "updated", rsvpVia: "imip",
            changes: [
              { field: "time", before: dayTime(slot(now, 3, 10, 60).start), after: dayTime(t.start) },
              { field: "location", before: "Atlas room", after: "Harbor room" },
            ],
          });
        },
      },
    ],
  },
  {
    // A cancellation.
    acct: "northwind", subject: "Canceled event: Q4 planning offsite prep @ Wed 4pm", unread: false,
    msgs: [{
      from: P.tomas, to: [{ name: "Alex Rivera", address: ME.northwind }], minsAgo: 3 * 60,
      text: "Tomas Lindqvist canceled this event: Q4 planning offsite prep, Wednesday 4pm to 5pm.",
      invite: (now) => {
        const t = slot(now, 1, 16, 60);
        return invite({
          uid: "offsite-prep-4410@google.com", method: "CANCEL", sequence: 2, ...t, title: "Q4 planning offsite prep",
          organizer: P.tomas, state: "cancelled", yourResponse: "accepted", rsvpVia: "none", googleEventUrl: "https://calendar.example/event?eid=offsiteprep",
          attendees: [att(P.tomas, "accepted", "chair"), att({ name: "Alex Rivera", address: ME.northwind }, "accepted", "required", true), att(P.sofia, "accepted")],
          invitedAs: { address: ME.northwind, role: "required", rsvp: true },
        });
      },
    }],
  },
  {
    // A Zoom invite from an Outlook organizer, on the Google account without calendar access.
    acct: "gmail", subject: "Customer interview: Harborline onboarding", unread: true,
    msgs: [{
      from: P.elena, to: [{ name: "Alex Rivera", address: ME.gmail }], minsAgo: 7 * 60,
      text: "Elena Petrova is inviting you to a scheduled Zoom meeting. Topic: Customer interview: Harborline onboarding. Join Zoom Meeting https://zoom.example/j/84120957731?pwd=abc Meeting ID: 841 2095 7731",
      invite: (now) => {
        const t = slot(now, 5, 9, 45);
        return invite({
          uid: "040000008200E00074C5B7101A82E00800000000A1B2C3D4E5F6@outlook.com", ...t, title: "Customer interview: Harborline onboarding",
          timeZone: "America/New_York", source: "outlook", organizer: P.elena,
          conference: { kind: "zoom", url: "https://zoom.example/j/84120957731?pwd=abc", label: "Zoom", code: "841 2095 7731", phone: "+1 555 010 0199" },
          attendees: [att(P.elena, "accepted", "chair"), att({ name: "Alex Rivera", address: ME.gmail }, "needs-action", "required", true), att(P.marcus, "needs-action"), att(P.ines, "tentative", "optional")],
          invitedAs: { address: ME.gmail, role: "required", rsvp: true }, rsvpVia: "google-needs-scope",
        });
      },
    }],
  },
  {
    // Someone answered an invite the user sent.
    acct: "northwind", subject: "Accepted: Cycle 3 kickoff @ Mon 10am", unread: true,
    msgs: [{
      from: P.carla, to: [{ name: "Alex Rivera", address: ME.northwind }], minsAgo: 22,
      text: "Carla Mendes has accepted this invitation. Cycle 3 kickoff, Monday 10am - 11am.",
      invite: (now) => {
        const t = slot(now, 6, 10, 60);
        return invite({
          uid: "cycle3-kickoff-9921@google.com", method: "REPLY", ...t, title: "Cycle 3 kickoff", organizer: { name: "Alex Rivera", address: ME.northwind },
          attendees: [att(P.carla, "accepted")], reply: { from: P.carla, response: "accepted", comment: "See you there. I will bring the signed scope." },
          state: "reply", rsvpVia: "none", googleEventUrl: "https://calendar.example/event?eid=cycle3",
        });
      },
    }],
  },
];

export function toChip(i: Invite, messageId: MessageRowId): InviteChip {
  return {
    uid: i.uid, method: i.method, title: i.title, start: i.start, end: i.end, allDay: i.allDay, startDate: i.startDate, state: i.state,
    yourResponse: i.yourResponse, organizerName: i.organizer?.name || i.organizer?.address || null, messageId,
  };
}

/** The invite a thread row should show: the newest message's, unless it is only a reply to the user's own invite. */
export function threadInvite(msgs: { id: MessageRowId; invite?: Invite }[]): InviteChip | undefined {
  const m = [...msgs].reverse().find((x) => x.invite);
  return m?.invite ? toChip(m.invite, m.id) : undefined;
}

export function findInviteMessage(state: MockState, messageId: MessageRowId): { accountId: string; invite: Invite } | null {
  for (const t of state.threads) {
    const m = t.messages.find((x) => x.id === messageId);
    if (m?.invite) return { accountId: t.accountId, invite: m.invite };
  }
  return null;
}

export function mockConflicts(state: MockState, messageId: MessageRowId, now: number): InviteConflicts {
  const found = findInviteMessage(state, messageId);
  if (!found) return { status: "unknown", reason: "no-time" };
  const account = state.accounts.find((a) => a.id === found.accountId);
  if (account?.authKind !== "oauth_google") return { status: "unknown", reason: "not-google" };
  if (!account.calendarScope) return { status: "unknown", reason: "no-scope" };
  // The weekly Design sync collides with one invented event; everything else is free.
  if (found.invite.uid.startsWith("design-sync")) {
    return { status: "conflict", checkedAt: now, events: [{ title: "1:1 with Tomas", start: found.invite.start + 15 * MIN, end: found.invite.start + 45 * MIN, allDay: false }] };
  }
  return { status: "free", checkedAt: now };
}

export function mockRsvp(i: Invite, response: RsvpResponse, note: string | undefined, now: number): Invite {
  if (i.state === "cancelled" || i.state === "past" || i.state === "reply" || i.state === "superseded" || i.state === "counter") {
    throw new Error("This invitation can no longer be answered.");
  }
  return {
    ...i, yourResponse: response, respondedAt: now, yourNote: note?.trim() || null,
    attendees: i.attendees.map((a) => (a.isYou ? { ...a, response } : a)),
  };
}

export function mockListInvites(state: MockState, opts: { accountId?: string; from?: number; to?: number; limit?: number } | undefined, now: number): InviteListItem[] {
  const from = opts?.from ?? now;
  return state.threads
    .filter((t) => !opts?.accountId || t.accountId === opts.accountId)
    .flatMap((t) => t.messages.map((m) => ({ t, m })))
    .filter(({ m }) => m.invite && m.invite.end >= from && (opts?.to === undefined || m.invite.start < opts.to) && !["cancelled", "past", "superseded", "reply"].includes(m.invite.state))
    .sort((a, b) => a.m.invite!.start - b.m.invite!.start)
    .slice(0, opts?.limit ?? 50)
    .map(({ t, m }) => ({ threadId: t.id, accountId: t.accountId, subject: t.subject, invite: toChip(m.invite!, m.id) }));
}
