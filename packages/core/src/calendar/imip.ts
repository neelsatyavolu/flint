import { FlintError, type Address, type RsvpResponse } from "../types";
import { PARTSTAT, type BuildImipReply, type ImipReplyInput } from "./contracts";

/** Pure builder for the iMIP REPLY mail (RFC 5546 section 3.2.3, RFC 6047). No I/O, no tracking pixel. */

const CRLF = "\r\n";
const MAX_OCTETS = 75;

/** Escapes a TEXT value (RFC 5545 3.3.11). */
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** A parameter value: quoted when it holds , ; : and never holding a double quote or control characters. */
function paramValue(s: string): string {
  const clean = s.replace(/"/g, "'").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return /[,;:]/.test(clean) ? `"${clean}"` : clean;
}

/** Folds a content line at 75 octets without splitting a UTF-8 character (RFC 5545 3.1). */
function fold(line: string): string {
  if (Buffer.byteLength(line) <= MAX_OCTETS) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  let limit = MAX_OCTETS;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (size + n > limit) {
      out.push(current);
      current = "";
      size = 1; // the leading space of the continuation line
      limit = MAX_OCTETS;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join(CRLF);
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** 20261027T150000Z */
export function icsUtc(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const icsDate = (isoDate: string): string => isoDate.replace(/-/g, "");

/** RECURRENCE-ID line from the raw value the calendar sent. A zoned local time gets the organizer's TZID back. */
function recurrenceIdLine(raw: string, timeZone: string | null): string {
  const value = raw.trim();
  if (/^\d{8}$/.test(value)) return `RECURRENCE-ID;VALUE=DATE:${value}`;
  if (/^\d{8}T\d{6}$/.test(value) && timeZone && timeZone !== "UTC") return `RECURRENCE-ID;TZID=${timeZone}:${value}`;
  return `RECURRENCE-ID:${value}`;
}

const mailto = (address: string): string => `mailto:${address.trim()}`;

function attendeeLine(attendee: Address, partstat: string): string {
  const cn = attendee.name.trim() ? `;CN=${paramValue(attendee.name)}` : "";
  return `ATTENDEE${cn};PARTSTAT=${partstat}:${mailto(attendee.address)}`;
}

/** The text/calendar body for a REPLY. CRLF line endings, folded, ends with a final CRLF. */
export function buildReplyIcs(input: ImipReplyInput, organizer: Address): string {
  const { invite, attendee, response, note, now } = input;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Flint//Flint Mail//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REPLY",
    "BEGIN:VEVENT",
    `UID:${invite.uid}`,
  ];
  if (invite.recurrenceId) lines.push(recurrenceIdLine(invite.recurrenceId, invite.timeZone));
  lines.push(`SEQUENCE:${invite.sequence}`, `DTSTAMP:${icsUtc(now)}`);
  if (invite.allDay && invite.startDate && invite.endDate) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(invite.startDate)}`, `DTEND;VALUE=DATE:${icsDate(invite.endDate)}`);
  } else {
    lines.push(`DTSTART:${icsUtc(invite.start)}`, `DTEND:${icsUtc(invite.end)}`);
  }
  const cn = organizer.name.trim() ? `;CN=${paramValue(organizer.name)}` : "";
  lines.push(`ORGANIZER${cn}:${mailto(organizer.address)}`);
  lines.push(attendeeLine(attendee, PARTSTAT[response]));
  if (invite.title) lines.push(`SUMMARY:${escapeText(invite.title)}`);
  const comment = note?.trim();
  if (comment) lines.push(`COMMENT:${escapeText(comment)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join(CRLF) + CRLF;
}

const SUBJECT_PREFIX: Record<RsvpResponse, string> = { accepted: "Accepted", tentative: "Tentative", declined: "Declined" };
const VERB: Record<RsvpResponse, string> = { accepted: "accepted", tentative: "replied maybe to", declined: "declined" };

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function whenText(input: ImipReplyInput): string {
  const { invite } = input;
  if (invite.allDay && invite.startDate) {
    const last = lastAllDay(invite.startDate, invite.endDate);
    return last === invite.startDate ? invite.startDate : `${invite.startDate} to ${last}`;
  }
  const zone = invite.timeZone && invite.timeZone !== "UTC" ? invite.timeZone : "UTC";
  try {
    const day = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", year: "numeric", month: "short", day: "numeric" }).format(invite.start);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
    return `${day}, ${time.format(invite.start)} to ${time.format(invite.end)} (${zone})`;
  } catch {
    return new Date(invite.start).toISOString();
  }
}

/** endDate is exclusive, so the last day is the day before it. */
function lastAllDay(startDate: string, endDate: string | null): string {
  if (!endDate) return startDate;
  const d = new Date(`${endDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const last = d.toISOString().slice(0, 10);
  return last < startDate ? startDate : last;
}

/** Builds the REPLY mail: subject, plain and HTML bodies (no images, no pixel) and the text/calendar part. */
export const buildImipReply: BuildImipReply = (input) => {
  const { invite, attendee, response } = input;
  const organizer = invite.organizer;
  if (!organizer?.address) throw new FlintError("invalid", "This invitation has no organizer to reply to.");
  const who = attendee.name.trim() || attendee.address;
  const lead = `${who} ${VERB[response]} this invitation.`;
  const note = input.note?.trim();
  const textLines = [lead, "", invite.title, `When: ${whenText(input)}`];
  if (note) textLines.push("", note);
  const htmlParts = [`<p>${escapeHtml(lead)}</p>`, `<p><b>${escapeHtml(invite.title)}</b><br>When: ${escapeHtml(whenText(input))}</p>`];
  if (note) htmlParts.push(`<p>${escapeHtml(note).replace(/\r?\n/g, "<br>")}</p>`);
  return {
    to: { name: organizer.name, address: organizer.address },
    subject: `${SUBJECT_PREFIX[response]}: ${invite.title || "(no title)"}`.replace(/[\r\n]+/g, " "),
    text: textLines.join("\n"),
    html: htmlParts.join(""),
    ics: buildReplyIcs(input, organizer),
    uid: invite.uid,
  };
};
