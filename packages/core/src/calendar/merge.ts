// Turns a stored parse into the Invite the UI shows: state (new/updated/cancelled/past/superseded/reply/counter), what
// changed since the previous version of the same event, the user's own answer, and how an RSVP would be delivered.
// Pure: the service gathers the stored versions and response and passes them in.
import type { Account, Invite, InviteChange, InviteResponse, InviteState } from "../types";
import type { ParsedInvite, StoredInvite, StoredResponse } from "./contracts";
import { nextOccurrence } from "./recurrence";
import { localZone, wallIn } from "./zones";

export type MergeEnv = {
  now: number;
  /** The user's addresses for this account (email plus aliases). */
  ownAddresses: readonly string[];
  account: Pick<Account, "provider" | "authKind" | "calendarScope">;
  /** Zone for the text in `changes`. Defaults to this machine's zone. */
  zone?: string;
  /** A calendar account (Settings > Calendars) that covers the invited address and so answers instead of the mail account's own sign-in. */
  calendarVia?: "google-calendar" | "caldav" | null;
};

export type MergeInput = {
  stored: StoredInvite;
  /** Every stored invite of the same event (UID + RECURRENCE-ID), this message's included, any order. */
  versions: readonly StoredInvite[];
  response: StoredResponse | null;
};

const DAY = 86_400_000;
const VERSIONED = new Set(["REQUEST", "PUBLISH", "CANCEL"]);

/** > 0 when a is the later version of the event than b: higher SEQUENCE, then later DTSTAMP, then a CANCEL beats a REQUEST. */
export function compareVersions(a: ParsedInvite, b: ParsedInvite): number {
  return a.sequence - b.sequence || (a.dtstamp ?? 0) - (b.dtstamp ?? 0) || Number(a.method === "CANCEL") - Number(b.method === "CANCEL");
}

// ---------- display text for "what changed" ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayText(w: { year: number; month: number; day: number }, nowYear: number): string {
  const dow = WEEKDAYS[new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()]!;
  return `${dow}, ${MONTHS[w.month - 1]} ${w.day}${w.year === nowYear ? "" : `, ${w.year}`}`;
}

const clock = (w: { hour: number; minute: number }): string => `${w.hour % 12 || 12}${w.minute ? `:${String(w.minute).padStart(2, "0")}` : ""} ${w.hour < 12 ? "AM" : "PM"}`;

/** "Tue, Oct 27, 3 PM to 4 PM" in the viewer's zone; all-day events by date. */
export function whenText(inv: Pick<ParsedInvite, "start" | "end" | "allDay">, zone: string, now: number): string {
  const nowYear = new Date(now).getUTCFullYear();
  if (inv.allDay) {
    const first = new Date(inv.start);
    const last = new Date(Math.max(inv.start, inv.end - DAY));
    const a = { year: first.getUTCFullYear(), month: first.getUTCMonth() + 1, day: first.getUTCDate() };
    const b = { year: last.getUTCFullYear(), month: last.getUTCMonth() + 1, day: last.getUTCDate() };
    return a.year === b.year && a.month === b.month && a.day === b.day ? dayText(a, nowYear) : `${dayText(a, nowYear)} to ${dayText(b, nowYear)}`;
  }
  const s = wallIn(inv.start, zone);
  const e = wallIn(inv.end, zone);
  const head = `${dayText(s, nowYear)}, ${clock(s)}`;
  if (inv.end === inv.start) return head;
  return s.year === e.year && s.month === e.month && s.day === e.day ? `${head} to ${clock(e)}` : `${head} to ${dayText(e, nowYear)}, ${clock(e)}`;
}

const clip = (s: string | null, n = 140): string | null => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);
const guestsOf = (i: ParsedInvite) => new Map(i.attendees.map((a) => [a.address, a.name || a.address]));

export function diffInvites(before: ParsedInvite, after: ParsedInvite, zone: string, now: number): InviteChange[] {
  const out: InviteChange[] = [];
  if (before.start !== after.start || before.end !== after.end || before.allDay !== after.allDay) {
    out.push({ field: "time", before: whenText(before, zone, now), after: whenText(after, zone, now) });
  }
  if ((before.location ?? "") !== (after.location ?? "")) out.push({ field: "location", before: before.location, after: after.location });
  if (before.title !== after.title) out.push({ field: "title", before: before.title, after: after.title });
  const was = guestsOf(before);
  const is = guestsOf(after);
  const added = [...is].filter(([k]) => !was.has(k)).map(([, name]) => name);
  const removed = [...was].filter(([k]) => !is.has(k)).map(([, name]) => name);
  if (added.length || removed.length) {
    const count = (n: number): string => `${n} guest${n === 1 ? "" : "s"}`;
    out.push({
      field: "guests", before: count(was.size),
      after: `${count(is.size)}${added.length ? `, added ${added.join(", ")}` : ""}${removed.length ? `, removed ${removed.join(", ")}` : ""}`,
    });
  }
  if ((before.recurrence?.summary ?? null) !== (after.recurrence?.summary ?? null)) {
    out.push({ field: "recurrence", before: before.recurrence?.summary ?? null, after: after.recurrence?.summary ?? null });
  }
  if ((before.conference?.url ?? null) !== (after.conference?.url ?? null)) {
    out.push({ field: "conference", before: before.conference?.label ?? null, after: after.conference?.label ?? null });
  }
  if ((before.description ?? "") !== (after.description ?? "")) {
    out.push({ field: "description", before: clip(before.description), after: clip(after.description) });
  }
  return out;
}

// ---------- recurring series: show the next occurrence ----------

type Times = Pick<Invite, "start" | "end" | "startDate" | "endDate">;

/**
 * For a series (RRULE, whole-series message) whose first occurrence is in the past, the occurrence the user cares about:
 * the one in progress or the next. `ended` is true when the series has no occurrence left.
 */
export function effectiveTimes(inv: ParsedInvite, now: number, viewerZone: string = localZone()): { times: Times; ended: boolean } {
  const own: Times = { start: inv.start, end: inv.end, startDate: inv.startDate, endDate: inv.endDate };
  const duration = Math.max(0, inv.end - inv.start);
  // All-day events are 00:00 UTC dates: compare them with the viewer's calendar date, not the instant.
  const after = inv.allDay ? allDayToday(now, viewerZone) - duration + 1 : now - duration;
  if (!inv.recurrence || inv.recurrenceId || inv.start >= after) return { times: own, ended: false };
  const zone = inv.allDay ? "UTC" : inv.timeZone ?? localZone();
  const next = nextOccurrence(inv.recurrence.rrule, wallIn(inv.start, zone), zone, after, inv.recurrence.excluded, inv.recurrence.added);
  if (next === null) return { times: own, ended: true };
  const end = next + duration;
  return {
    times: {
      start: next, end,
      startDate: inv.allDay ? new Date(next).toISOString().slice(0, 10) : null,
      endDate: inv.allDay ? new Date(end).toISOString().slice(0, 10) : null,
    },
    ended: false,
  };
}

/** 00:00 UTC of the viewer's current calendar date: the unit all-day events are stored in. */
export function allDayToday(now: number, zone: string): number {
  const w = wallIn(now, zone);
  return Date.UTC(w.year, w.month - 1, w.day);
}

// ---------- the merge ----------

function ownResponse(inv: ParsedInvite, response: StoredResponse | null, isOrganizer: boolean): Pick<Invite, "yourResponse" | "respondedAt" | "yourNote"> {
  const carried: InviteResponse = isOrganizer ? "accepted" : inv.attendees.find((a) => a.isYou)?.response ?? "needs-action";
  if (response && !(carried !== "needs-action" && inv.dtstamp !== null && inv.dtstamp > response.respondedAt)) {
    return { yourResponse: response.response, respondedAt: response.respondedAt, yourNote: response.note };
  }
  return { yourResponse: carried, respondedAt: null, yourNote: null };
}

function rsvpRoute(env: MergeEnv, inv: ParsedInvite, state: InviteState, isOrganizer: boolean): Invite["rsvpVia"] {
  const { account } = env;
  if (state !== "new" && state !== "updated") return "none";
  if (inv.method !== "REQUEST" || !inv.invitedAs || isOrganizer || !inv.organizer) return "none";
  const gmail = account.provider === "gmail" && account.authKind === "oauth_google";
  if (gmail && account.calendarScope) return "google-calendar";
  if (env.calendarVia) return env.calendarVia;
  return gmail ? "google-needs-scope" : "imip";
}

export function mergeInvite(input: MergeInput, env: MergeEnv): Invite {
  const { stored } = input;
  const inv = stored.invite;
  const zone = env.zone ?? localZone();
  const own = new Set(env.ownAddresses.map((a) => a.toLowerCase()));
  const isOrganizer = inv.organizer !== null && own.has(inv.organizer.address.toLowerCase());
  const yours = ownResponse(inv, input.response, isOrganizer);
  const base = { ...inv, ...yours, changes: [] as InviteChange[], newerMessageId: null as number | null };

  const finish = (state: InviteState, extra: Partial<Pick<Invite, "changes" | "newerMessageId" | "start" | "end" | "startDate" | "endDate">> = {}): Invite =>
    ({ ...base, ...extra, state, rsvpVia: rsvpRoute(env, inv, state, isOrganizer) });

  if (inv.method === "REPLY") return finish("reply");
  if (inv.method !== "REQUEST" && inv.method !== "PUBLISH" && inv.method !== "CANCEL") return finish("counter");
  if (inv.method === "CANCEL") return finish("cancelled");

  const versions = input.versions.filter((v) => VERSIONED.has(v.invite.method));
  let newest = stored;
  for (const v of versions) if (v.messageId !== stored.messageId && compareVersions(v.invite, newest.invite) > 0) newest = v;
  if (newest.messageId !== stored.messageId) {
    return newest.invite.method === "CANCEL" ? finish("cancelled") : finish("superseded", { newerMessageId: newest.messageId });
  }

  const { times, ended } = effectiveTimes(inv, env.now, zone);
  const over = inv.allDay ? times.end <= allDayToday(env.now, zone) : times.end < env.now;
  if (ended || over) return finish("past", times);

  const earlier = versions.filter((v) => v.messageId !== stored.messageId && v.invite.method !== "CANCEL" && compareVersions(v.invite, inv) < 0);
  const previous = earlier.reduce<StoredInvite | null>((best, v) => (best === null || compareVersions(v.invite, best.invite) > 0 ? v : best), null);
  if (previous) {
    const changes = diffInvites(previous.invite, inv, zone, env.now);
    if (inv.sequence > previous.invite.sequence || changes.length > 0) return finish("updated", { ...times, changes });
  }
  return finish("new", times);
}
