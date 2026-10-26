import { describe, expect, it } from "vitest";
import { CalDavClient, discover, eventsBetween, findByUid, multistatus, normalizeServerUrl, putEvent, sameSite, strongEtag } from "../src/calendar/caldav";
import { fixture } from "../src/calendar/fixtures";
import { createFakeCaldav, type FakeCaldav } from "./fake-caldav";

const ICLOUD = "https://caldav.icloud.com";
const FASTMAIL = "https://caldav.fastmail.com/dav/";
const event = (uid: string, start: string, end: string, extra = ""): string =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${uid} event\r\nDTSTART:${start}\r\nDTEND:${end}\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;

function connect(fake: FakeCaldav, url: string, username: string, password = "app-pass") {
  return new CalDavClient({ fetch: fake.fetch, username, password, serverUrl: normalizeServerUrl(url) });
}

describe("normalizeServerUrl / sameSite", () => {
  it("requires https except for loopback, and adds https to a bare host", () => {
    expect(normalizeServerUrl("caldav.example.com/dav")).toBe("https://caldav.example.com/dav");
    expect(() => normalizeServerUrl("http://caldav.example.com")).toThrow(/https/);
    expect(normalizeServerUrl("http://127.0.0.1:8080/dav/")).toBe("http://127.0.0.1:8080/dav/");
    expect(() => normalizeServerUrl("http://")).toThrow();
  });

  it("trusts the same host and sibling hosts of one domain, nothing else", () => {
    const u = (s: string) => new URL(s);
    expect(sameSite(u("https://caldav.icloud.com"), u("https://p12-caldav.icloud.com:443/x"))).toBe(true);
    expect(sameSite(u("https://caldav.icloud.com"), u("https://icloud.com.evil.example/x"))).toBe(false);
    expect(sameSite(u("https://127.0.0.1:1"), u("https://127.0.0.1:2"))).toBe(true);
  });

  it("does not trust other tenants of a shared public suffix, nor other IP addresses", () => {
    const u = (s: string) => new URL(s);
    expect(sameSite(u("https://caldav.example.co.uk"), u("https://evil.co.uk/x"))).toBe(false);
    expect(sameSite(u("https://me.github.io"), u("https://evil.github.io"))).toBe(false);
    expect(sameSite(u("https://dav.example.com"), u("https://other.example.com"))).toBe(false);
    expect(sameSite(u("https://192.168.1.5"), u("https://169.254.1.5"))).toBe(false);
    expect(sameSite(u("https://192.168.1.5"), u("https://10.9.1.5"))).toBe(false);
    expect(sameSite(u("https://caldav.icloud.com"), u("https://evil.icloud.com"))).toBe(false);
    expect(sameSite(u("https://caldav.fastmail.com"), u("https://d1.fastmail.com"))).toBe(true);
    expect(sameSite(u("https://evil.example"), u("https://caldav.icloud.com"))).toBe(false);
  });

  it("never sends the password to a host a redirect points at outside the allowed set", async () => {
    const seen: string[] = [];
    const client = new CalDavClient({
      serverUrl: "https://192.168.1.5/", username: "u", password: "p",
      fetch: async (url) => { seen.push(url); return { status: 302, headers: { get: (n) => (n === "location" ? "https://169.254.1.5/x" : null) }, text: async () => "" }; },
    });
    await expect(client.request("PROPFIND", "https://192.168.1.5/")).rejects.toMatchObject({ code: "invalid" });
    expect(seen).toEqual(["https://192.168.1.5/"]);
  });
});

describe("multistatus / etags", () => {
  const body = (inner: string) => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${inner}</d:multistatus>`;
  it("a 404 propstat listed before the 200 one does not make the entry a failure", () => {
    const [e] = multistatus(body(`<d:response><d:href>/a.ics</d:href>
      <d:propstat><d:prop><d:getetag/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
      <d:propstat><d:prop><c:calendar-data>BEGIN:VCALENDAR</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`), "https://x.example/");
    expect(e!.status).toBe(200);
    expect(e!.props.has("calendar-data")).toBe(true);
  });

  it("keeps a response-level status and a failing-only propstat", () => {
    const es = multistatus(body(`<d:response><d:href>/gone.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>
      <d:response><d:href>/b.ics</d:href><d:propstat><d:prop><d:getetag/></d:prop><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response>`), "https://x.example/");
    expect(es.map((e) => e.status)).toEqual([404, 403]);
  });

  it("strongEtag strips the weak marker and putEvent refuses an update with no tag", async () => {
    expect(strongEtag('W/"abc"')).toBe('"abc"');
    expect(strongEtag(null)).toBeNull();
    const client = new CalDavClient({ serverUrl: "https://x.example/", username: "u", password: "p", fetch: async () => { throw new Error("must not be called"); } });
    await expect(putEvent(client, "https://x.example/a.ics", "x", { ifMatch: null })).rejects.toMatchObject({ code: "invalid" });
  });

  it("fetches the tag with GET when the REPORT left it out", async () => {
    const fake = createFakeCaldav({ flavor: "fastmail", username: "me@fastmail.com", password: "app-pass" });
    fake.add("work", "e", event("e1", "20261027T150000Z", "20261027T160000Z"));
    const client = connect(fake, FASTMAIL, "me@fastmail.com");
    const real = fake.fetch;
    const stripped: typeof fake.fetch = async (url, init) => {
      const r = await real(url, init);
      if (init.method !== "REPORT") return r;
      const text = (await r.text()).replace(/<D:getetag>[^<]*<\/D:getetag>/g, "");
      return { status: r.status, headers: r.headers, text: async () => text };
    };
    const c2 = new CalDavClient({ fetch: stripped, username: "me@fastmail.com", password: "app-pass", serverUrl: normalizeServerUrl(FASTMAIL) });
    const d = await discover(client, normalizeServerUrl(FASTMAIL));
    const found = await findByUid(c2, d.calendars, "e1");
    expect(found?.etag).toMatch(/^"fm-/);
  });

  it("keeps looking in later calendars when one refuses the query", async () => {
    const fake = createFakeCaldav({ flavor: "fastmail", username: "me@fastmail.com", password: "app-pass" });
    fake.add("work", "e", event("e1", "20261027T150000Z", "20261027T160000Z"));
    const client = connect(fake, FASTMAIL, "me@fastmail.com");
    const d = await discover(client, normalizeServerUrl(FASTMAIL));
    fake.override = (m, u) => (m === "REPORT" && u.pathname.endsWith("/personal/") ? { status: 403, headers: { get: () => null }, text: async () => "" } : null);
    const cals = [{ url: new URL("/dav/calendars/user/me@fastmail.com/home/", FASTMAIL).toString(), name: "Home" }, ...d.calendars];
    expect((await findByUid(client, [{ url: cals[0]!.url, name: "x" }, ...d.calendars], "e1"))?.url).toContain("e.ics");
  });
});

describe("discovery", () => {
  it("finds the iCloud principal through .well-known, the cross-host calendar home, the calendars and the default one", async () => {
    const fake = createFakeCaldav({ flavor: "icloud", username: "appleid@icloud.com", password: "app-pass", addresses: ["appleid@icloud.com", "Neel@Xanom.co"] });
    const d = await discover(connect(fake, ICLOUD, "appleid@icloud.com"), normalizeServerUrl(ICLOUD));
    expect(fake.log[0]).toMatchObject({ method: "PROPFIND", url: "https://caldav.icloud.com/.well-known/caldav" });
    expect(d.principalUrl).toBe("https://caldav.icloud.com/1234567/principal/");
    expect(d.homeUrl).toBe("https://p12-caldav.icloud.com/1234567/calendars/");
    expect(d.calendars.map((c) => c.name)).toEqual(["Home", "Work"]); // no Reminders (VTODO only), inbox or outbox
    expect(d.defaultCalendar.name).toBe("Work"); // schedule-default-calendar-URL wins
    expect(d.addresses).toEqual(["appleid@icloud.com", "neel@xanom.co"]);
    expect(d.scheduling).toBe(true);
    expect(d.outboxUrl).toContain("/outbox/");
  });

  it("finds the Fastmail principal on the DAV path itself and reads prefixed answers", async () => {
    const fake = createFakeCaldav({ flavor: "fastmail", username: "me@fastmail.com", password: "app-pass" });
    const d = await discover(connect(fake, FASTMAIL, "me@fastmail.com"), normalizeServerUrl(FASTMAIL));
    expect(fake.log[0]).toMatchObject({ method: "PROPFIND", url: FASTMAIL });
    expect(d.principalUrl).toBe("https://caldav.fastmail.com/dav/principals/user/me@fastmail.com/");
    expect(d.calendars.map((c) => c.name)).toEqual(["Personal", "Work"]);
    expect(d.addresses).toEqual(["me@fastmail.com"]);
    expect(d.scheduling).toBe(true);
  });

  it("sends Basic credentials, Depth headers and a PROPFIND body naming what it wants", async () => {
    const fake = createFakeCaldav({ flavor: "fastmail", username: "me@fastmail.com", password: "app-pass" });
    await discover(connect(fake, FASTMAIL, "me@fastmail.com"), normalizeServerUrl(FASTMAIL));
    const first = fake.log[0]!;
    expect(first.headers["authorization"]).toBe(`Basic ${Buffer.from("me@fastmail.com:app-pass").toString("base64")}`);
    expect(first.headers["depth"]).toBe("0");
    expect(first.body).toContain("current-user-principal");
    expect(fake.log.find((l) => l.body.includes("calendar-home-set"))).toBeTruthy();
    expect(fake.log.find((l) => l.headers["depth"] === "1")).toBeTruthy();
  });

  it("without scheduling support: no outbox, no auto-schedule header, default by name", async () => {
    const fake = createFakeCaldav({ flavor: "fastmail", username: "me@fastmail.com", password: "app-pass", scheduling: false });
    const d = await discover(connect(fake, FASTMAIL, "me@fastmail.com"), normalizeServerUrl(FASTMAIL));
    expect(d.scheduling).toBe(false);
    expect(d.outboxUrl).toBeNull();
    expect(d.defaultCalendar.name).toBe("Personal");
  });

  it("an outbox without calendar-auto-schedule is not implicit scheduling", async () => {
    const fake = createFakeCaldav({ flavor: "fastmail", username: "me@fastmail.com", password: "app-pass", scheduling: true, autoSchedule: false });
    const d = await discover(connect(fake, FASTMAIL, "me@fastmail.com"), normalizeServerUrl(FASTMAIL));
    expect(d.outboxUrl).not.toBeNull();
    expect(d.scheduling).toBe(false);
  });

  it("reports a rejected password as an auth error", async () => {
    const fake = createFakeCaldav({ flavor: "icloud", username: "appleid@icloud.com", password: "right" });
    await expect(discover(connect(fake, ICLOUD, "appleid@icloud.com", "wrong"), normalizeServerUrl(ICLOUD))).rejects.toMatchObject({ code: "auth", message: expect.stringContaining("username or password") });
  });

  it("explains a server that is not CalDAV", async () => {
    const client = new CalDavClient({ serverUrl: "https://example.com/", username: "u", password: "p", fetch: async () => ({ status: 404, headers: { get: () => null }, text: async () => "" }) });
    await expect(discover(client, "https://example.com/")).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("Could not find a calendar account") });
  });

  it("stops when the server sends credentials to another site, and never follows a redirect off https", async () => {
    const bounce = (to: string) => new CalDavClient({
      serverUrl: "https://dav.example.com/", username: "u", password: "p",
      fetch: async () => ({ status: 302, headers: { get: (n) => (n === "location" ? to : null) }, text: async () => "" }),
    });
    await expect(bounce("https://evil.example.net/").request("PROPFIND", "https://dav.example.com/")).rejects.toMatchObject({ code: "invalid" });
    await expect(bounce("http://dav.example.com/").request("PROPFIND", "https://dav.example.com/")).rejects.toMatchObject({ code: "invalid" });
  });

  it("gives up on a redirect loop", async () => {
    const loop = new CalDavClient({ serverUrl: "https://dav.example.com/", username: "u", password: "p", fetch: async () => ({ status: 301, headers: { get: (n) => (n === "location" ? "/again" : null) }, text: async () => "" }) });
    await expect(loop.request("GET", "https://dav.example.com/")).rejects.toMatchObject({ code: "network" });
  });

  it("maps a network failure to a friendly error", async () => {
    const down = new CalDavClient({ serverUrl: "https://dav.example.com/", username: "u", password: "p", fetch: async () => { throw new Error("ECONNREFUSED 10.0.0.1"); } });
    await expect(down.request("GET", "https://dav.example.com/")).rejects.toMatchObject({ code: "network", message: expect.not.stringContaining("10.0.0.1") });
  });
});

describe("events", () => {
  const uid = "6mk3qd8c1p2v9rj4tb0h5s7xyz@google.com";

  async function ready(flavor: "icloud" | "fastmail") {
    const user = flavor === "icloud" ? "appleid@icloud.com" : "me@fastmail.com";
    const fake = createFakeCaldav({ flavor, username: user, password: "app-pass" });
    const client = connect(fake, flavor === "icloud" ? ICLOUD : FASTMAIL, user);
    const d = await discover(client, normalizeServerUrl(flavor === "icloud" ? ICLOUD : FASTMAIL));
    return { fake, client, calendars: [d.defaultCalendar, ...d.calendars.filter((c) => c.url !== d.defaultCalendar.url)] };
  }

  it.each(["icloud", "fastmail"] as const)("finds an event by UID in %s, byte for byte (escaped or CDATA calendar-data)", async (flavor) => {
    const { fake, client, calendars } = await ready(flavor);
    const ics = fixture("google-weekly-meet.ics").replace("METHOD:REQUEST\r\n", "");
    fake.add("home", "other", event("other-uid", "20261027T150000Z", "20261027T160000Z"));
    const href = fake.add("home", "design", ics); // the non-default calendar: it is searched after the default one
    const found = await findByUid(client, calendars, uid);
    expect(found).toMatchObject({ ics, etag: fake.resources.get(href)!.etag });
    expect(new URL(found!.url).pathname).toBe(href);
    const report = fake.log.filter((l) => l.method === "REPORT");
    expect(report[0]!.body).toContain(`<c:text-match collation="i;octet">${uid}</c:text-match>`);
    expect(report[0]!.headers["depth"]).toBe("1");
    expect(report.length).toBe(2); // default calendar (empty) first, then the other
  });

  it("returns null when no calendar has the UID and escapes the UID in the query", async () => {
    const { fake, client, calendars } = await ready("fastmail");
    fake.add("home", "a", event("a", "20261027T150000Z", "20261027T160000Z"));
    expect(await findByUid(client, calendars, "x<y>&z")).toBeNull();
    expect(fake.log.at(-1)!.body).toContain("x&lt;y&gt;&amp;z");
  });

  it("creates with If-None-Match, updates with If-Match, and reports 412 for a stale ETag or an existing resource", async () => {
    const { fake, client, calendars } = await ready("icloud");
    const url = new URL("new.ics", calendars[0]!.url).toString();
    const created = await putEvent(client, url, event("new", "20261027T150000Z", "20261027T160000Z"), { ifNoneMatch: true });
    expect(created).toMatchObject({ ok: true, etag: expect.stringMatching(/^"C=\d+"$/) });
    expect(fake.log.at(-1)!.headers["if-none-match"]).toBe("*");
    expect(await putEvent(client, url, "x", { ifNoneMatch: true })).toEqual({ ok: false, reason: "precondition-failed" });
    expect(await putEvent(client, url, "x", { ifMatch: '"stale"' })).toEqual({ ok: false, reason: "precondition-failed" });
    const etag = (created as { etag: string }).etag;
    const updated = await putEvent(client, url, event("new", "20261027T160000Z", "20261027T170000Z"), { ifMatch: etag });
    expect(updated.ok).toBe(true);
    expect(fake.log.at(-1)!.headers["if-match"]).toBe(etag);
    expect(fake.log.at(-1)!.headers["content-type"]).toContain("text/calendar");
  });

  it("lists the events in a time range with the server expanding recurrences", async () => {
    const { fake, client, calendars } = await ready("fastmail");
    fake.add("work", "in", event("in", "20261027T150000Z", "20261027T160000Z"));
    fake.add("work", "out", event("out", "20261101T150000Z", "20261101T160000Z"));
    const got = await eventsBetween(client, calendars[0]!.url, Date.UTC(2026, 9, 27, 15, 30), Date.UTC(2026, 9, 27, 16, 30));
    expect(got).toHaveLength(1);
    expect(got[0]).toContain("UID:in");
    const body = fake.log.at(-1)!.body;
    expect(body).toContain('<c:time-range start="20261027T153000Z" end="20261027T163000Z"/>');
    expect(body).toContain('<c:expand start="20261027T153000Z" end="20261027T163000Z"/>');
  });
});
