import { FlintError, type InviteResponse, type RsvpResponse } from "../types";
import type { GoogleCalendarClient, GoogleCalendarEvent, GoogleRespondInput } from "./contracts";

export const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary";

type Res = { ok: boolean; status: number; json(): Promise<unknown> };
export type CalendarFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Res>;

type Attendee = { email?: string; self?: boolean; responseStatus?: string; comment?: string; [k: string]: unknown };
type ApiEvent = {
  id?: string; iCalUID?: string; summary?: string; status?: string; etag?: string; htmlLink?: string; transparency?: string;
  recurrence?: string[]; recurringEventId?: string;
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
  originalStartTime?: { date?: string; dateTime?: string };
  attendees?: Attendee[];
};

const STATUS: Record<RsvpResponse, string> = { accepted: "accepted", tentative: "tentative", declined: "declined" };
const MAX_PAGES = 3;

const API_NOT_ENABLED = "Google Calendar is not turned on for this Google client. Enable the Google Calendar API in the Google Cloud project, then try again.";

/** The 403 for a token that lacks the calendar scope. Only this error (not a 401) means the grant is gone. */
export const SCOPE_MISSING_MESSAGE = "Flint needs permission to use Google Calendar. Connect Google Calendar and try again.";
export const isScopeMissing = (e: unknown): boolean => e instanceof FlintError && e.code === "auth" && e.message === SCOPE_MISSING_MESSAGE;

/** Maps a Google error reply to the FlintError the service understands (see GoogleCalendarClient). */
async function failure(res: Res): Promise<FlintError> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } } | null;
  const reason = body?.error?.errors?.[0]?.reason ?? "";
  const s = res.status;
  if (s === 401) return new FlintError("auth", "Google Calendar sign-in expired. Connect Google Calendar again.");
  if (s === 403) {
    if (/scope|insufficient/i.test(reason) || /insufficient/i.test(body?.error?.message ?? "") || body?.error?.status === "PERMISSION_DENIED" && /scope/i.test(body.error.message ?? "")) {
      return new FlintError("auth", SCOPE_MISSING_MESSAGE);
    }
    if (/rate|quota/i.test(reason)) return new FlintError("network", "Google Calendar is busy. Try again in a moment.");
    if (reason === "accessNotConfigured" || /has not been used|is disabled/i.test(body?.error?.message ?? "")) return new FlintError("invalid", API_NOT_ENABLED);
    return new FlintError("permission", "Google Calendar did not allow that change.");
  }
  if (s === 404 || s === 410) return new FlintError("not_found", "That event is not on your Google Calendar.");
  if (s === 429 || s >= 500) return new FlintError("network", "Google Calendar is temporarily unavailable. Try again in a moment.");
  if (s === 400) return new FlintError("invalid", "Google Calendar could not use that request.");
  return new FlintError("network", `Google Calendar returned an error (${s}).`);
}

function client(f: CalendarFetch, accessToken: string) {
  async function call(method: string, path: string, params?: Record<string, string>, body?: unknown, extra?: Record<string, string>): Promise<{ status: number; data: unknown }> {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    let res: Res;
    try {
      res = await f(`${CALENDAR_API}${path}${qs}`, {
        method,
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...extra },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new FlintError("network", "Could not reach Google Calendar. Check your connection and try again.");
    }
    if (res.status === 412) return { status: 412, data: null };
    if (!res.ok) throw await failure(res);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  return { call };
}

/** "20261027T150000Z" / "20261027" / "20261027T150000" to a comparable form. */
function parseRid(rid: string): { kind: "utc"; ms: number } | { kind: "date"; date: string } | { kind: "local"; wall: string } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(rid.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { kind: "date", date: `${y}-${mo}-${d}` };
  if (z) return { kind: "utc", ms: Date.UTC(+y!, +mo! - 1, +d!, +h, +mi!, +s!) };
  return { kind: "local", wall: `${y}-${mo}-${d}T${h}:${mi}:${s}` };
}

function matchesInstance(rid: ReturnType<typeof parseRid>, e: ApiEvent): boolean {
  const o = e.originalStartTime ?? e.start;
  if (!rid || !o) return false;
  if (rid.kind === "date") return o.date === rid.date || o.dateTime?.slice(0, 10) === rid.date;
  if (!o.dateTime) return false;
  if (rid.kind === "utc") return Date.parse(o.dateTime) === rid.ms;
  return o.dateTime.slice(0, 19) === rid.wall;
}

/** Epoch ms for an event time. All-day dates are midnight UTC, the same convention as Invite.start. */
function instant(t: { date?: string; dateTime?: string } | undefined): number | null {
  const v = t?.dateTime ?? t?.date;
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

function selfOf(e: ApiEvent, addresses: readonly string[]): Attendee | undefined {
  const own = new Set(addresses.map((a) => a.toLowerCase()));
  return e.attendees?.find((a) => a.self === true || (a.email !== undefined && own.has(a.email.toLowerCase())));
}

const selfStatus = (e: ApiEvent): InviteResponse | null => {
  const s = e.attendees?.find((a) => a.self === true)?.responseStatus;
  return s === "accepted" || s === "tentative" || s === "declined" || s === "needsAction" ? (s === "needsAction" ? "needs-action" : s) : null;
};

export function createGoogleCalendarClient(opts: { fetch: CalendarFetch }): GoogleCalendarClient {
  return {
    async respond(input: GoogleRespondInput) {
      const { call } = client(opts.fetch, input.accessToken);
      const target = await findEvent(call, input);
      for (let attempt = 0; attempt < 2; attempt++) {
        const fresh = attempt === 0 ? target : await fetchEvent(call, target.id!);
        const self = selfOf(fresh, input.selfAddresses);
        if (!self) throw new FlintError("not_found", "You are not a guest on the Google Calendar copy of this event.");
        const attendees = (fresh.attendees ?? []).map((a) => (a === self
          ? { ...a, responseStatus: STATUS[input.response], ...(input.comment ? { comment: input.comment } : {}) }
          : a));
        const res = await call("PATCH", `/events/${encodeURIComponent(fresh.id!)}`, { sendUpdates: "all" }, { attendees }, fresh.etag ? { "if-match": fresh.etag } : undefined);
        if (res.status === 412) continue; // someone changed the event between our read and write: read again once
        const done = res.data as ApiEvent;
        return { eventId: done.id ?? fresh.id!, htmlLink: done.htmlLink ?? fresh.htmlLink ?? null };
      }
      throw new FlintError("conflict", "The event changed while Flint was answering. Try again.");
    },

    async listEvents({ accessToken, from, to }) {
      const { call } = client(opts.fetch, accessToken);
      const out: GoogleCalendarEvent[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data } = await call("GET", "/events", {
          timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(),
          singleEvents: "true", orderBy: "startTime", maxResults: "50", showDeleted: "false",
          ...(pageToken ? { pageToken } : {}),
        });
        const body = data as { items?: ApiEvent[]; nextPageToken?: string };
        for (const e of body.items ?? []) {
          const start = instant(e.start);
          const end = instant(e.end);
          if (e.status === "cancelled" || start === null || end === null || !e.id) continue;
          const mine = selfStatus(e);
          // Free ("transparent") events do not block time, and declined ones are not on the schedule.
          if (mine === "declined" || e.transparency === "transparent") continue;
          out.push({
            id: e.id, iCalUID: e.iCalUID ?? "", title: e.summary ?? "(No title)", start, end,
            allDay: Boolean(e.start?.date), selfResponse: mine, htmlLink: e.htmlLink ?? null,
          });
        }
        pageToken = body.nextPageToken;
        if (!pageToken) break;
      }
      return out;
    },
  };
}

type Call = ReturnType<typeof client>["call"];

async function fetchEvent(call: Call, id: string): Promise<ApiEvent> {
  const { data } = await call("GET", `/events/${encodeURIComponent(id)}`);
  return data as ApiEvent;
}

/** Finds the event (or the one occurrence) for an invite's UID on the primary calendar. Throws not_found when absent. */
async function findEvent(call: Call, input: GoogleRespondInput): Promise<ApiEvent> {
  const { data } = await call("GET", "/events", { iCalUID: input.uid, showDeleted: "false", maxResults: "50" });
  const items = ((data as { items?: ApiEvent[] }).items ?? []).filter((e) => e.status !== "cancelled" && e.id);
  if (items.length === 0) throw new FlintError("not_found", "That event is not on your Google Calendar.");
  const rid = input.recurrenceId ? parseRid(input.recurrenceId) : null;
  if (!input.recurrenceId) {
    // Whole event or series: the master (it carries `recurrence`) or the only single event, never an exception.
    return items.find((e) => e.recurrence) ?? items.find((e) => !e.recurringEventId) ?? items[0]!;
  }
  // One occurrence. Google returns an exception under the same iCalUID when it was edited; otherwise expand the series.
  const exception = items.find((e) => e.recurringEventId && matchesInstance(rid, e));
  if (exception) return exception;
  const master = items.find((e) => e.recurrence);
  if (!master) {
    // The calendar holds a single event for this UID; the recurrence id names it.
    return items[0]!;
  }
  if (!rid) throw new FlintError("not_found", "That occurrence is not on your Google Calendar.");
  const center = rid.kind === "utc" ? rid.ms : Date.parse(rid.kind === "date" ? `${rid.date}T00:00:00Z` : `${rid.wall}Z`);
  const day = 24 * 3600 * 1000;
  const { data: inst } = await call("GET", `/events/${encodeURIComponent(master.id!)}/instances`, {
    timeMin: new Date(center - day).toISOString(), timeMax: new Date(center + 2 * day).toISOString(), showDeleted: "false", maxResults: "20",
  });
  const hit = ((inst as { items?: ApiEvent[] }).items ?? []).find((e) => e.status !== "cancelled" && matchesInstance(rid, e));
  if (!hit) throw new FlintError("not_found", "That occurrence is not on your Google Calendar.");
  return hit;
}
