// CalDAV client (RFC 4791, scheduling detection per RFC 6638). Discovery follows the usual chain: .well-known/caldav,
// current-user-principal, calendar-home-set, the calendars in the home. `fetch` is injected, so tests never reach a server.
import { FlintError } from "../types";
import { hasUid } from "./icsEdit";
import { decodeEntities, descendants, kids, parseXml, path, textOf, type XNode } from "./xml";

export type DavResponse = { status: number; headers: { get(name: string): string | null }; text(): Promise<string> };
/** Must NOT follow redirects itself: the client re-sends credentials only to hosts it trusts. */
export type DavFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; redirect: "manual" }) => Promise<DavResponse>;

export type DavReply = { status: number; text: string; url: string; headers: DavResponse["headers"] };

const MAX_REDIRECTS = 5;
const NS = `xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"`;
const XML_HEAD = `<?xml version="1.0" encoding="utf-8"?>`;

const isLoopback = (host: string): boolean => host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";

/** Provider families whose CalDAV answers legitimately point at sibling hosts (iCloud shards: p12-caldav.icloud.com). */
const SIBLING_FAMILIES: readonly RegExp[] = [/^(p\d+-)?caldav\.icloud\.com$/i, /^([a-z0-9-]+\.)*fastmail\.com$/i];

/**
 * Where credentials may follow: the exact host the user typed (any port), or another host of the same known provider family
 * when the user typed one of them. Everything else, IP literals and shared public suffixes (co.uk, github.io) included,
 * is a different site.
 */
export function sameSite(a: URL, b: URL): boolean {
  if (a.hostname.toLowerCase() === b.hostname.toLowerCase()) return true;
  return SIBLING_FAMILIES.some((f) => f.test(a.hostname) && f.test(b.hostname));
}

/** The address a user typed, normalized, with https required (loopback may use http for local servers and tests). */
export function normalizeServerUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new FlintError("invalid", "That server address is not valid. It should look like https://caldav.example.com.");
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopback(u.hostname))) throw new FlintError("invalid", "The server address must start with https://, so your password is not sent in the clear.");
  u.hash = "";
  return u.toString();
}

const xmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type DavEntry = { href: string; status: number; props: Map<string, XNode> };

/** Reads a 207 body. Properties come from propstat blocks answered 2xx; `status` is the response-level one, else 200 when any propstat succeeded (else the first propstat's). */
export function multistatus(text: string, base: string): DavEntry[] {
  let root: XNode;
  try {
    root = parseXml(text);
  } catch {
    throw new FlintError("invalid", "The calendar server sent an answer Flint could not read.");
  }
  const entries: DavEntry[] = [];
  for (const r of descendants(root, "response")) {
    const hrefText = textOf(r.children.find((c) => c.name === "href"));
    if (!hrefText) continue;
    const props = new Map<string, XNode>();
    const own = Number(/\s(\d{3})\b/.exec(textOf(r.children.find((c) => c.name === "status")))?.[1] ?? 0);
    let firstCode = 0;
    let anyOk = false;
    for (const ps of kids(r, "propstat")) {
      const code = Number(/\s(\d{3})\b/.exec(textOf(path(ps, "status")))?.[1] ?? 200);
      if (!firstCode) firstCode = code;
      if (code < 200 || code >= 300) continue;
      anyOk = true;
      for (const p of path(ps, "prop")?.children ?? []) props.set(p.name, p);
    }
    // A 404 propstat for one missing property (getetag) listed before the 200 one must not hide the resource.
    const status = own || (anyOk ? 200 : firstCode);
    entries.push({ href: resolveHref(hrefText, base), status: status || 200, props });
  }
  return entries;
}

export function resolveHref(href: string, base: string): string {
  try {
    return new URL(decodeEntities(href.trim()), base).toString();
  } catch {
    return href;
  }
}

const hrefOf = (n: XNode | undefined, base: string): string | null => {
  const h = textOf(n?.children.find((c) => c.name === "href") ?? null);
  return h ? resolveHref(h, base) : null;
};

export class CalDavClient {
  readonly #auth: string;
  /** Hosts credentials may go to: where the user pointed us, plus same-site redirects and discovered URLs. */
  readonly #origin: URL;

  constructor(private opts: { fetch: DavFetch; username: string; password: string; serverUrl: string }) {
    this.#auth = `Basic ${Buffer.from(`${opts.username}:${opts.password}`, "utf8").toString("base64")}`;
    this.#origin = new URL(opts.serverUrl);
  }

  async request(method: string, url: string, init: { headers?: Record<string, string>; body?: string; depth?: "0" | "1" } = {}): Promise<DavReply> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = new URL(current);
      if (!sameSite(this.#origin, target) || (target.protocol !== "https:" && !isLoopback(target.hostname))) {
        throw new FlintError("invalid", "The calendar server pointed Flint at a different site, so it stopped. Check the server address.");
      }
      let res: DavResponse;
      try {
        res = await this.opts.fetch(current, {
          method, redirect: "manual",
          headers: {
            authorization: this.#auth, "user-agent": "Flint", accept: "application/xml, text/calendar, text/xml, */*",
            ...(init.body ? { "content-type": method === "PUT" ? "text/calendar; charset=utf-8" : "application/xml; charset=utf-8" } : {}),
            ...(init.depth ? { depth: init.depth } : {}), ...init.headers,
          },
          ...(init.body ? { body: init.body } : {}),
        });
      } catch {
        throw new FlintError("network", "Could not reach the calendar server. Check your connection and the server address.");
      }
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const to = res.headers.get("location");
        if (!to) throw new FlintError("network", `The calendar server answered ${res.status} without saying where to go.`);
        current = new URL(to, current).toString();
        continue;
      }
      return { status: res.status, text: await res.text().catch(() => ""), url: current, headers: res.headers };
    }
    throw new FlintError("network", "The calendar server redirected too many times.");
  }

  /** request() that turns failure statuses into FlintErrors (412 and the ones in `allow` are returned). */
  async call(method: string, url: string, init: Parameters<CalDavClient["request"]>[2] = {}, allow: readonly number[] = []): Promise<DavReply> {
    const r = await this.request(method, url, init);
    if (r.status < 400 || allow.includes(r.status)) return r;
    throw failure(r.status);
  }
}

export function failure(status: number): FlintError {
  if (status === 401) return new FlintError("auth", "The server rejected the username or password.");
  if (status === 403) return new FlintError("permission", "The calendar server did not allow that.");
  if (status === 404 || status === 410) return new FlintError("not_found", "The calendar server could not find that.");
  if (status === 412) return new FlintError("conflict", "The event changed on the server.");
  if (status === 429 || status >= 500) return new FlintError("network", "The calendar server is temporarily unavailable. Try again in a moment.");
  return new FlintError("invalid", `The calendar server did not accept that request (${status}).`);
}

// ---------- discovery ----------

export type DiscoveredCalendar = { url: string; name: string };
export type Discovery = {
  principalUrl: string; homeUrl: string; inboxUrl: string | null; outboxUrl: string | null; displayName: string | null;
  addresses: string[]; calendars: DiscoveredCalendar[]; defaultCalendar: DiscoveredCalendar; scheduling: boolean;
};

const propfind = (props: string): string => `${XML_HEAD}<d:propfind ${NS}><d:prop>${props}</d:prop></d:propfind>`;

async function findPrincipal(client: CalDavClient, serverUrl: string): Promise<{ principal: string; base: string }> {
  const origin = new URL(serverUrl);
  const wellKnown = new URL("/.well-known/caldav", origin).toString();
  const hasPath = origin.pathname.replace(/\/+$/, "") !== "";
  const candidates = hasPath ? [serverUrl, wellKnown] : [wellKnown, serverUrl];
  let lastAuth: FlintError | null = null;
  for (const url of candidates) {
    const r = await client.request("PROPFIND", url, { depth: "0", body: propfind("<d:current-user-principal/>") });
    if (r.status === 401) { lastAuth = failure(401); break; }
    if (r.status !== 207 && r.status !== 200) continue;
    try {
      const entry = multistatus(r.text, r.url)[0];
      const principal = hrefOf(entry?.props.get("current-user-principal"), r.url);
      if (principal) return { principal, base: r.url };
    } catch { /* try the next candidate */ }
  }
  throw lastAuth ?? new FlintError("invalid", "Could not find a calendar account at that address. Check the server address and try again.");
}

const hasComponent = (set: XNode | undefined, name: string): boolean =>
  !set || set.children.length === 0 || set.children.some((c) => c.name === "comp" && (c.attrs["name"] ?? "").toUpperCase() === name);

function pickDefault(calendars: DiscoveredCalendar[], preferred: string | null): DiscoveredCalendar {
  const hit = preferred ? calendars.find((c) => sameUrl(c.url, preferred)) : undefined;
  if (hit) return hit;
  return calendars.find((c) => /^(home|calendar|personal|default|my calendar)$/i.test(c.name.trim())) ?? calendars[0]!;
}

export const sameUrl = (a: string, b: string): boolean => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/** Principal, calendar home, calendars, the addresses the server knows for the user, and whether it schedules for us. */
export async function discover(client: CalDavClient, serverUrl: string): Promise<Discovery> {
  const { principal } = await findPrincipal(client, serverUrl);
  const p = await client.call("PROPFIND", principal, {
    depth: "0",
    body: propfind("<c:calendar-home-set/><c:calendar-user-address-set/><c:schedule-outbox-URL/><c:schedule-inbox-URL/><d:displayname/>"),
  });
  let davHeader = p.headers.get("dav") ?? "";
  if (!davHeader) {
    try { davHeader = (await client.request("OPTIONS", principal)).headers.get("dav") ?? ""; } catch { /* leave it empty: no scheduling */ }
  }
  const pe = multistatus(p.text, p.url)[0];
  const home = hrefOf(pe?.props.get("calendar-home-set"), p.url);
  if (!home) throw new FlintError("invalid", "This account does not offer calendars over CalDAV.");
  const inboxUrl = hrefOf(pe?.props.get("schedule-inbox-url"), p.url);
  const outboxUrl = hrefOf(pe?.props.get("schedule-outbox-url"), p.url);
  const addresses = [...new Set(kids(pe?.props.get("calendar-user-address-set"), "href")
    .map((h) => textOf(h)).filter((h) => /^mailto:/i.test(h)).map((h) => decodeEntities(h).replace(/^mailto:/i, "").trim().toLowerCase()))];

  const h = await client.call("PROPFIND", home, {
    depth: "1", body: propfind("<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/>"),
  });
  const calendars: DiscoveredCalendar[] = [];
  for (const e of multistatus(h.text, h.url)) {
    const types = e.props.get("resourcetype")?.children.map((c) => c.name) ?? [];
    if (!types.includes("calendar") || types.some((t) => t === "schedule-inbox" || t === "schedule-outbox" || t === "subscribed")) continue;
    if (!hasComponent(e.props.get("supported-calendar-component-set"), "VEVENT")) continue;
    calendars.push({ url: e.href, name: textOf(e.props.get("displayname")) || "Calendar" });
  }
  if (calendars.length === 0) throw new FlintError("invalid", "This account has no calendar that holds events.");

  let preferred: string | null = null;
  if (inboxUrl) {
    try {
      const r = await client.call("PROPFIND", inboxUrl, { depth: "0", body: propfind("<c:schedule-default-calendar-URL/>") });
      preferred = hrefOf(multistatus(r.text, r.url)[0]?.props.get("schedule-default-calendar-url"), r.url);
    } catch { /* not every server offers it */ }
  }
  // Only implicit scheduling (calendar-auto-schedule) makes the server tell the organizer when a PARTSTAT is PUT; a server with
  // an outbox but without it expects the client to POST the reply itself, so Flint must still send the iMIP mail.
  const scheduling = /(^|[\s,])calendar-auto-schedule(\s*,|\s*$)/i.test(davHeader);
  return {
    principalUrl: principal, homeUrl: home, inboxUrl, outboxUrl, displayName: textOf(pe?.props.get("displayname")) || null, addresses,
    calendars, defaultCalendar: pickDefault(calendars, preferred), scheduling,
  };
}

// ---------- events ----------

/** An ETag usable in If-Match: a weak tag (W/"x") is sent as its opaque value, which servers compare for If-Match. Null when absent. */
export const strongEtag = (raw: string | null | undefined): string | null => {
  const t = (raw ?? "").trim().replace(/^W\//i, "");
  return t || null;
};

export type FoundEvent = { url: string; etag: string | null; ics: string; calendarUrl: string };

/** calendar-data as sent, minus the whitespace some servers put before BEGIN (trailing bytes are kept: the file is written back as is). */
const icsText = (n: XNode | undefined): string => (n?.text ?? "").replace(/^\s+/, "");

const calStamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

async function report(client: CalDavClient, calendarUrl: string, body: string): Promise<DavEntry[]> {
  const r = await client.call("REPORT", calendarUrl, { depth: "1", body }, [404]);
  if (r.status === 404 || !r.text.trim()) return [];
  return multistatus(r.text, r.url);
}

/** The calendar resource holding this UID, searched calendar by calendar (the default one first). Null when none has it. */
export async function findByUid(client: CalDavClient, calendars: readonly DiscoveredCalendar[], uid: string): Promise<FoundEvent | null> {
  const body = `${XML_HEAD}<c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
    `<c:prop-filter name="UID"><c:text-match collation="i;octet">${xmlEscape(uid)}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  for (const cal of calendars) {
    let entries: DavEntry[];
    try {
      entries = await report(client, cal.url, body);
    } catch (error) {
      // One calendar that refuses or cannot run the query (403, 501) must not hide the event from the calendars after it.
      if (error instanceof FlintError && (error.code === "permission" || error.code === "invalid")) continue;
      throw error;
    }
    for (const e of entries) {
      const hasData = e.props.has("calendar-data");
      if ((e.status >= 400 && !hasData) || (e.href.endsWith("/") && !hasData)) continue;
      let ics = icsText(e.props.get("calendar-data"));
      let etag = strongEtag(textOf(e.props.get("getetag")));
      if (!ics || !etag) {
        // Some servers answer the query with names only, or leave the ETag out: fetch the resource itself.
        const got = await client.call("GET", e.href, {}, [404]);
        if (got.status === 404) continue;
        if (!ics) ics = got.text;
        etag = strongEtag(got.headers.get("etag")) ?? etag;
      }
      if (hasUid(ics, uid)) return { url: e.href, etag, ics, calendarUrl: cal.url };
    }
  }
  return null;
}

export type PutResult = { ok: true; etag: string | null } | { ok: false; reason: "precondition-failed" };

/** PUT an event. `ifMatch` updates only that version; `ifNoneMatch` creates only when nothing is there. One of them is required. */
export async function putEvent(client: CalDavClient, url: string, ics: string, cond: { ifMatch?: string | null; ifNoneMatch?: boolean }): Promise<PutResult> {
  const ifMatch = strongEtag(cond.ifMatch);
  if (!ifMatch && !cond.ifNoneMatch) throw new FlintError("invalid", "The calendar server gave no version tag for this event, so Flint will not overwrite it.");
  const r = await client.call("PUT", url, {
    body: ics,
    headers: { ...(ifMatch ? { "if-match": ifMatch } : {}), ...(cond.ifNoneMatch ? { "if-none-match": "*" } : {}) },
  }, [412]);
  if (r.status === 412) return { ok: false, reason: "precondition-failed" };
  return { ok: true, etag: r.headers.get("etag") };
}

/** Expanded VEVENTs (as .ics text) in a calendar between two instants. Recurrences are expanded by the server. */
export async function eventsBetween(client: CalDavClient, calendarUrl: string, from: number, to: number): Promise<string[]> {
  const range = `start="${calStamp(from)}" end="${calStamp(to)}"`;
  const body = `${XML_HEAD}<c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data><c:expand ${range}/></c:calendar-data></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  return (await report(client, calendarUrl, body)).filter((e) => e.status < 400).map((e) => icsText(e.props.get("calendar-data"))).filter(Boolean);
}
