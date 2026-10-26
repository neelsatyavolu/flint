// An in-memory CalDAV server for tests, shaped like the answers iCloud and Fastmail (Cyrus) give: namespace prefixes,
// absolute and relative hrefs, calendar-data escaped (iCloud) or in CDATA (Fastmail), ETags, If-Match / If-None-Match,
// server-side scheduling replies. Nothing here touches the network.
import type { DavFetch } from "../src/calendar/caldav";
import { events, parseDoc, simpleEvents } from "../src/calendar/icsEdit";

export type Flavor = "icloud" | "fastmail";
export type Logged = { method: string; url: string; headers: Record<string, string>; body: string };
type Resource = { etag: string; ics: string; calendar: string };

export type FakeCaldav = {
  fetch: DavFetch;
  log: Logged[];
  resources: Map<string, Resource>;
  /** Replies the server would have sent to organizers because the user changed PARTSTAT. */
  scheduled: { uid: string; partstat: string; href: string }[];
  /** Runs once before the next PUT is evaluated (simulates someone else changing the event). */
  beforeNextPut: (() => void) | null;
  /** Answers a request itself (returns a reply) or lets the fake handle it (returns null). */
  override: ((method: string, url: URL) => { status: number; headers: { get(n: string): string | null }; text(): Promise<string> } | null) | null;
  /** Adds (or replaces) a resource and returns its href. */
  add(calendar: "home" | "work", name: string, ics: string): string;
  base: string;
  calendarHref(calendar: "home" | "work"): string;
};

const CAL = "urn:ietf:params:xml:ns:caldav";
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function createFakeCaldav(o: { flavor: Flavor; username: string; password: string; addresses?: string[]; scheduling?: boolean; autoSchedule?: boolean; host?: string }): FakeCaldav {
  const icloud = o.flavor === "icloud";
  const host = o.host ?? (icloud ? "caldav.icloud.com" : "caldav.fastmail.com");
  const homeHost = icloud ? "p12-caldav.icloud.com" : host;
  const scheduling = o.scheduling ?? true;
  const principal = icloud ? "/1234567/principal/" : `/dav/principals/user/${o.username}/`;
  const homePath = icloud ? "/1234567/calendars/" : `/dav/calendars/user/${o.username}/`;
  const home = (name: string): string => `${homePath}${name}/`;
  const abs = (path: string): string => (icloud ? `https://${homeHost}:443${path}` : path);
  const resources = new Map<string, Resource>();
  const log: Logged[] = [];
  const scheduled: FakeCaldav["scheduled"] = [];
  let etagN = 0;
  const nextEtag = (): string => `"${icloud ? "C=" : "fm-"}${++etagN}"`;
  const wrapNs = (inner: string): string => (icloud
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<multistatus xmlns="DAV:" xmlns:C="${CAL}">${inner}</multistatus>`
    : `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:" xmlns:C="${CAL}">${inner}</D:multistatus>`);
  const d = (tag: string, inner = ""): string => (icloud ? `<${tag}>${inner}</${tag}>` : `<D:${tag}>${inner}</D:${tag}>`);
  const c = (tag: string, inner = ""): string => `<C:${tag}>${inner}</C:${tag}>`;
  const response = (href: string, props: string): string => d("response", d("href", esc(href)) + d("propstat", d("prop", props) + d("status", "HTTP/1.1 200 OK")));
  const calendarData = (ics: string): string => (icloud ? esc(ics).replace(/\r/g, "&#13;") : `<![CDATA[${ics}]]>`);

  const result = (status: number, body = "", headers: Record<string, string> = {}) => ({
    status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, text: async () => body,
  });
  const autoSchedule = scheduling && (o.autoSchedule ?? true);
  const dav = autoSchedule ? "1, 2, 3, calendar-access, calendar-auto-schedule, calendar-query-extended" : "1, 2, 3, calendar-access";

  const calendarList = [
    { id: "home", name: icloud ? "Home" : "Personal" },
    { id: "work", name: "Work" },
  ];
  const collection = (href: string, name: string, kinds: string, extra = ""): string =>
    response(href, d("resourcetype", kinds) + d("displayname", esc(name)) + extra);

  function handle(method: string, url: URL, headers: Record<string, string>, body: string) {
    const auth = `Basic ${Buffer.from(`${o.username}:${o.password}`).toString("base64")}`;
    if (headers["authorization"] !== auth) return result(401, "", { "www-authenticate": 'Basic realm="CalDAV"' });
    const p = url.pathname;
    const dh = { dav };
    if (p === "/.well-known/caldav") return result(301, "", { location: icloud ? "/" : "/dav/" });
    if (method === "PROPFIND") {
      if ((icloud && p === "/") || (!icloud && p === "/dav/")) {
        return result(207, wrapNs(response(p, d("current-user-principal", d("href", principal)))), dh);
      }
      if (p === principal) {
        const addresses = [...(o.addresses ?? [o.username]), `/principals/__uuids__/ABC/`].map((a) => (a.startsWith("/") ? a : `mailto:${a}`));
        let props = c("calendar-home-set", d("href", abs(homePath))) + c("calendar-user-address-set", addresses.map((a) => d("href", esc(a))).join("")) + d("displayname", "Neel");
        if (scheduling) props += c("schedule-outbox-URL", d("href", abs(home("outbox")))) + c("schedule-inbox-URL", d("href", abs(home("inbox"))));
        return result(207, wrapNs(response(principal, props)), dh);
      }
      if (p === homePath) {
        const cal = (id: string, name: string) => collection(home(id), name, d("collection") + c("calendar"), c("supported-calendar-component-set", `<C:comp name="VEVENT"/><C:comp name="VTODO"/>`));
        const todos = collection(home("tasks"), "Reminders", d("collection") + c("calendar"), c("supported-calendar-component-set", `<C:comp name="VTODO"/>`));
        const inbox = collection(home("inbox"), "Inbox", d("collection") + c("schedule-inbox"));
        const outbox = collection(home("outbox"), "Outbox", d("collection") + c("schedule-outbox"));
        const own = collection(homePath, "", d("collection"));
        return result(207, wrapNs(own + todos + inbox + outbox + calendarList.map((x) => cal(x.id, x.name)).join("")), dh);
      }
      if (p === home("inbox")) return result(207, wrapNs(response(p, c("schedule-default-calendar-URL", d("href", home("work"))))), dh);
      return result(404);
    }
    if (method === "REPORT") {
      const cal = calendarList.find((x) => p === home(x.id));
      if (!cal) return result(404);
      const uid = /<(?:\w+:)?text-match[^>]*>([^<]*)</.exec(body)?.[1];
      const range = /time-range\s+start="(\w+)"\s+end="(\w+)"/.exec(body);
      const wantData = /calendar-data/.test(body);
      const parseStamp = (s: string): number => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));
      const out: string[] = [];
      for (const [href, r] of resources) {
        if (r.calendar !== cal.id) continue;
        if (uid && !events(parseDoc(r.ics)).some((b) => b.props.some((x) => x.prop.name === "UID" && x.prop.value.trim() === uid.replace(/&amp;/g, "&")))) continue;
        if (range) {
          const [from, to] = [parseStamp(range[1]!), parseStamp(range[2]!)];
          if (!simpleEvents(r.ics, []).some((e) => e.start < to && e.end > from)) continue;
        }
        out.push(response(href, d("getetag", r.etag) + (wantData ? c("calendar-data", calendarData(r.ics)) : "")));
      }
      return result(207, wrapNs(out.join("")), dh);
    }
    if (p.startsWith(homePath) && (method === "PUT" || method === "GET")) {
      const cal = calendarList.find((x) => p.startsWith(home(x.id)));
      if (!cal) return result(404);
      const existing = resources.get(p);
      if (method === "GET") return existing ? result(200, existing.ics, { etag: existing.etag, "content-type": "text/calendar" }) : result(404);
      if (state.beforeNextPut) { const f = state.beforeNextPut; state.beforeNextPut = null; f(); }
      const current = resources.get(p);
      if (headers["if-none-match"] === "*" && current) return result(412);
      if (headers["if-match"] && current?.etag !== headers["if-match"]) return result(412);
      const etag = nextEtag();
      resources.set(p, { etag, ics: body, calendar: cal.id });
      noteSchedule(current?.ics ?? null, body, p);
      return result(current ? 204 : 201, "", { etag });
    }
    return result(405);
  }

  /** What RFC 6638 implicit scheduling does: a changed PARTSTAT on an attendee entry is reported to the organizer. */
  function noteSchedule(before: string | null, after: string, href: string): void {
    if (!autoSchedule) return;
    const mine = new Set((o.addresses ?? [o.username]).map((a) => a.toLowerCase()));
    const parts = (ics: string | null): Map<string, string> => {
      const m = new Map<string, string>();
      if (!ics) return m;
      for (const b of events(parseDoc(ics))) {
        const uid = b.props.find((x) => x.prop.name === "UID")?.prop.value.trim() ?? "";
        for (const x of b.props) {
          if (x.prop.name !== "ATTENDEE" || !mine.has(x.prop.value.replace(/^mailto:/i, "").toLowerCase())) continue;
          m.set(uid, /;PARTSTAT=([^;:]*)/i.exec(x.prop.params)?.[1] ?? "NEEDS-ACTION");
        }
      }
      return m;
    };
    const was = parts(before);
    for (const [uid, partstat] of parts(after)) if (was.get(uid) !== partstat && partstat !== "NEEDS-ACTION") scheduled.push({ uid, partstat, href });
  }

  const state: FakeCaldav = {
    log, resources, scheduled, beforeNextPut: null, override: null, base: `https://${host}/`,
    calendarHref: (id) => abs(home(id)),
    add(calendar, name, ics) {
      const href = `${home(calendar)}${name}.ics`;
      resources.set(href, { etag: nextEtag(), ics, calendar });
      return href;
    },
    fetch: async (url, init) => {
      const u = new URL(url);
      const headers = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
      log.push({ method: init.method, url, headers, body: init.body ?? "" });
      // The fake serves one site; a request for the iCloud "pNN" host is the same server.
      if (u.hostname !== host && u.hostname !== homeHost) return result(502);
      const forced = state.override?.(init.method, u);
      if (forced) return forced;
      return handle(init.method, u, headers, init.body ?? "");
    },
  };
  return state;
}
