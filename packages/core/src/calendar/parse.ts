// iCalendar (RFC 5545 / iTIP RFC 5546) invitation parser. ical.js tokenizes (folding, escapes, parameters); the rest is ours:
// time zone mapping (including Outlook's Windows names), all-day dates, attendees, conference links, and a recurrence summary.
import ICAL from "ical.js";
import type {
  Address, Invite, InviteAttendee, InviteMethod, InviteRecurrence, InviteResponse,
} from "../types";
import type { ParseContext, ParsedInvite } from "./contracts";
import { cleanDescription, findConference } from "./conference";
import { summarizeRecurrence } from "./recurrence";
import { localZone, resolveZone, wallToEpoch, type Wall } from "./zones";

const METHODS: readonly InviteMethod[] = ["REQUEST", "CANCEL", "REPLY", "PUBLISH", "COUNTER", "DECLINECOUNTER", "REFRESH", "ADD"];
const DAY_MS = 86_400_000;

type Prop = ICAL.Property;

const str = (p: Prop | null | undefined): string => {
  const v = p?.getFirstValue();
  return typeof v === "string" ? v : v == null ? "" : String(v);
};
const text = (c: ICAL.Component, name: string): string => str(c.getFirstProperty(name)).trim();
const valueOf = (p: Prop): string => String(p.jCal[3] ?? "");
const typeOf = (p: Prop): string => String(p.jCal[2] ?? "");

type Moment = { epoch: number; zone: string | null; wall: Wall; dateOnly: boolean; date: string };

function wallOf(value: string): Wall | null {
  const m = /^(\d{4})-?(\d\d)-?(\d\d)(?:T(\d\d):?(\d\d):?(\d\d)?)?/.exec(value);
  if (!m) return null;
  return { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +(m[4] ?? 0), minute: +(m[5] ?? 0), second: +(m[6] ?? 0) };
}

const isoDate = (w: Wall): string => `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;

/** Time zones declared inside the file, for TZIDs we cannot map ourselves ("Customized Time Zone"). */
function zonesIn(cal: ICAL.Component): Map<string, ICAL.Timezone> {
  const out = new Map<string, ICAL.Timezone>();
  for (const vtz of cal.getAllSubcomponents("vtimezone")) {
    try {
      const tz = new ICAL.Timezone(vtz);
      const id = String(vtz.getFirstPropertyValue("tzid") ?? "");
      if (id) out.set(id, tz);
    } catch { /* ignore a broken VTIMEZONE */ }
  }
  return out;
}

function readMoment(p: Prop | null, vtz: Map<string, ICAL.Timezone>, only?: string): Moment | null {
  if (!p) return null;
  const value = only ?? valueOf(p);
  const wall = wallOf(value);
  if (!wall) return null;
  if (typeOf(p) === "date" || !value.includes("T")) {
    return { epoch: Date.UTC(wall.year, wall.month - 1, wall.day), zone: null, wall, dateOnly: true, date: isoDate(wall) };
  }
  const date = isoDate(wall);
  if (value.endsWith("Z")) return { epoch: Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second), zone: "UTC", wall, dateOnly: false, date };
  const tzid = String(p.getParameter("tzid") ?? "");
  const iana = resolveZone(tzid);
  if (iana) return { epoch: wallToEpoch(wall, iana), zone: iana, wall, dateOnly: false, date };
  const custom = tzid ? vtz.get(tzid) : undefined;
  if (custom) {
    try {
      const t = ICAL.Time.fromData({ year: wall.year, month: wall.month, day: wall.day, hour: wall.hour, minute: wall.minute, second: wall.second }, custom);
      const lic = resolveZone(String(custom.component.getFirstPropertyValue("x-lic-location") ?? ""));
      return { epoch: t.toUnixTime() * 1000, zone: lic, wall, dateOnly: false, date };
    } catch { /* fall through to floating */ }
  }
  return { epoch: wallToEpoch(wall, localZone()), zone: null, wall, dateOnly: false, date };
}

/** Every date of the EXDATE or RDATE lines (each line may list several), as epoch ms in the event's own terms. */
function datesOf(event: ICAL.Component, name: string, vtz: Map<string, ICAL.Timezone>): number[] {
  const out: number[] = [];
  for (const p of event.getAllProperties(name)) {
    for (const v of (p.jCal as unknown[]).slice(3)) {
      const m = readMoment(p, vtz, String(v));
      if (m) out.push(m.epoch);
    }
  }
  return out;
}

function durationMs(p: Prop | null): number | null {
  if (!p) return null;
  try {
    const d = ICAL.Duration.fromString(String(p.jCal[3]));
    return d.toSeconds() * 1000;
  } catch {
    return null;
  }
}

const PARTSTAT: Record<string, InviteResponse> = { ACCEPTED: "accepted", TENTATIVE: "tentative", DECLINED: "declined" };
const ROLES: Record<string, InviteAttendee["role"]> = { CHAIR: "chair", "OPT-PARTICIPANT": "optional", "NON-PARTICIPANT": "non-participant" };

function mailbox(value: string): string {
  const v = value.trim().replace(/^mailto:/i, "").trim().toLowerCase();
  return v.includes("@") ? v : "";
}

function readAttendee(p: Prop, own: ReadonlySet<string>): InviteAttendee | null {
  const address = mailbox(String(p.jCal[3] ?? ""));
  if (!address) return null;
  const cutype = String(p.getParameter("cutype") ?? "").toUpperCase();
  if (cutype === "RESOURCE" || cutype === "ROOM") return null;
  const partstat = String(p.getParameter("partstat") ?? "NEEDS-ACTION").toUpperCase();
  return {
    name: String(p.getParameter("cn") ?? "").trim(), address,
    response: PARTSTAT[partstat] ?? "needs-action",
    role: ROLES[String(p.getParameter("role") ?? "").toUpperCase()] ?? "required",
    rsvp: String(p.getParameter("rsvp") ?? "").toUpperCase() === "TRUE",
    isYou: own.has(address),
  };
}

function sourceOf(prodid: string): Invite["source"] {
  const p = prodid.toLowerCase();
  if (p.includes("google")) return "google";
  if (p.includes("zoom")) return "zoom";
  if (p.includes("microsoft") || p.includes("outlook") || p.includes("exchange")) return "outlook";
  if (p.includes("apple") || p.includes("icloud") || p.includes("ical")) return "apple";
  return "other";
}

const GOOGLE_EVENT = /https?:\/\/(?:www\.)?google\.com\/calendar\/(?:event\?[^\s<>"')]*eid=[\w-]+[^\s<>"')]*|u\/\d+\/r\/eventedit\/[\w-]+)/i;

/** "eid" Google's event page accepts for an event it generated itself: base64(eventId + " " + calendarEmail). */
function googleEventUrlFor(uid: string, address: string | undefined): string | null {
  const m = /^([a-z0-9]+)@google\.com$/i.exec(uid);
  if (!m || !address) return null;
  return `https://www.google.com/calendar/event?eid=${Buffer.from(`${m[1]} ${address}`).toString("base64").replace(/=+$/, "")}`;
}

/** The RECURRENCE-ID as a key: timed values in UTC ("20261027T150000Z"), all-day as a date ("20261027"). */
function recurrenceKey(p: Prop | null, vtz: Map<string, ICAL.Timezone>): string | null {
  const m = readMoment(p, vtz);
  if (!m) return null;
  if (m.dateOnly) return m.date.replace(/-/g, "");
  const d = new Date(m.epoch);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const NON_LOCATIONS = /^(microsoft teams( meeting)?|zoom( meeting)?|google meet|online( meeting)?|video ?call|webex( meeting)?|skype( meeting)?)$/i;

function readLocation(raw: string, conferenceUrl: string | null): string | null {
  let loc = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join(", ");
  if (!loc) return null;
  if (conferenceUrl && loc.includes(conferenceUrl)) loc = loc.replace(conferenceUrl, "").replace(/^[\s,;-]+|[\s,;-]+$/g, "");
  return !loc || NON_LOCATIONS.test(loc) ? null : loc;
}

function firstDocument(ics: string): ICAL.Component | null {
  const cleaned = ics.replace(/^﻿/, "").trim();
  if (!/BEGIN:VCALENDAR/i.test(cleaned)) return null;
  const jcal = ICAL.parse(cleaned) as unknown;
  const first = Array.isArray(jcal) && Array.isArray(jcal[0]) ? (jcal[0] as unknown[]) : jcal;
  return new ICAL.Component(first as never);
}

/** See ParseInvite in contracts.ts. Never throws; returns null when the text holds no event. */
export function parseInvite(ics: string, ctx: ParseContext): ParsedInvite | null {
  try {
    return parseUnsafe(ics, ctx);
  } catch {
    return null;
  }
}

function parseUnsafe(ics: string, ctx: ParseContext): ParsedInvite | null {
  const cal = firstDocument(ics);
  if (!cal) return null;
  const events = cal.getAllSubcomponents("vevent");
  if (events.length === 0) return null;
  const event = events.find((e) => !e.hasProperty("recurrence-id")) ?? events[0]!;
  const vtz = zonesIn(cal);
  const own = new Set(ctx.ownAddresses.map((a) => a.trim().toLowerCase()));

  const start = readMoment(event.getFirstProperty("dtstart"), vtz);
  if (!start) return null;
  const endRaw = readMoment(event.getFirstProperty("dtend"), vtz);
  const duration = durationMs(event.getFirstProperty("duration"));
  const allDay = start.dateOnly;

  let end: number;
  let endDate: string | null = null;
  if (allDay) {
    const endMs = endRaw?.dateOnly ? endRaw.epoch : duration !== null ? start.epoch + duration : start.epoch + DAY_MS;
    end = endMs <= start.epoch ? start.epoch + DAY_MS : endMs;
    endDate = new Date(end).toISOString().slice(0, 10);
  } else {
    end = endRaw ? endRaw.epoch : duration !== null ? start.epoch + duration : start.epoch;
    if (end < start.epoch) end = start.epoch;
  }

  const rawMethod = str(cal.getFirstProperty("method")).trim().toUpperCase();
  let method: InviteMethod = (METHODS as readonly string[]).includes(rawMethod) ? (rawMethod as InviteMethod) : "PUBLISH";
  if ((method === "REQUEST" || method === "PUBLISH") && text(event, "status").toUpperCase() === "CANCELLED") method = "CANCEL";

  const attendees = event.getAllProperties("attendee").flatMap((p) => { const a = readAttendee(p, own); return a ? [a] : []; });
  const orgProp = event.getFirstProperty("organizer");
  const orgAddress = orgProp ? mailbox(String(orgProp.jCal[3] ?? "")) : "";
  const organizer: Address | null = orgAddress ? { name: String(orgProp!.getParameter("cn") ?? "").trim(), address: orgAddress } : null;
  const you = attendees.find((a) => a.isYou) ?? null;

  const description = text(event, "description");
  const urlProp = text(event, "url");
  const location = text(event, "location");
  const conference = findConference({
    googleConference: text(event, "x-google-conference"),
    vendorUrls: [text(event, "x-microsoft-skypeteamsmeetingurl"), text(event, "x-microsoft-onlinemeetingexternallink")],
    location, url: urlProp, description,
  });

  const prodid = str(cal.getFirstProperty("prodid"));
  const source = sourceOf(prodid);
  const uid = text(event, "uid") || `no-uid:${text(event, "summary")}:${start.epoch}`;
  const recurrenceId = recurrenceKey(event.getFirstProperty("recurrence-id"), vtz);

  const rrule = event.getFirstProperty("rrule");
  const rruleText = rrule ? String(rrule.getFirstValue()) : "";
  const hasExceptions = event.hasProperty("exdate") || event.hasProperty("rdate") || events.some((e) => e !== event && e.hasProperty("recurrence-id"));
  const recurrence: InviteRecurrence | null = rruleText
    ? { summary: summarizeRecurrence(rruleText, start.wall, start.zone), rrule: rruleText, hasExceptions, excluded: datesOf(event, "exdate", vtz), added: datesOf(event, "rdate", vtz) }
    : null;

  const dtstampProp = event.getFirstProperty("dtstamp") ?? event.getFirstProperty("last-modified") ?? event.getFirstProperty("created");
  const dtstamp = dtstampProp ? readMoment(dtstampProp, vtz)?.epoch ?? null : null;

  const urlIsGoogle = GOOGLE_EVENT.exec(urlProp)?.[0] ?? null;
  const googleEventUrl = urlIsGoogle ?? GOOGLE_EVENT.exec(description)?.[0] ?? (source === "google" ? googleEventUrlFor(uid, you?.address) : null);
  const url = urlProp && !urlIsGoogle && urlProp !== conference?.url ? urlProp : null;

  let reply: ParsedInvite["reply"] = null;
  if (method === "REPLY") {
    const from = attendees[0];
    if (from) reply = { from: { name: from.name, address: from.address }, response: from.response, comment: text(event, "comment") || null };
  }

  const seq = Number.parseInt(text(event, "sequence"), 10);
  return {
    uid, method, sequence: Number.isFinite(seq) ? seq : 0, recurrenceId,
    title: text(event, "summary") || "Untitled event",
    description: cleanDescription(description, conference?.url),
    start: start.epoch, end, allDay,
    startDate: allDay ? start.date : null, endDate,
    timeZone: allDay ? null : start.zone,
    recurrence, location: readLocation(location, conference?.url ?? null), url, conference, organizer, attendees,
    invitedAs: you ? { address: you.address, role: you.role, rsvp: you.rsvp } : null,
    dtstamp, source, googleEventUrl, reply,
  };
}
