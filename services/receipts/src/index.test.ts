import { describe, expect, it, vi } from "vitest";
import { purge } from "./cron";
import worker from "./index";
import { install, setup, T0, TOKEN_A, TOKEN_B } from "./test/helpers";

const GMAIL_UA = "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

async function registered() {
  const s = setup();
  const auth = await install(s.call);
  const res = await s.call("/v1/messages", { ...post({ ref: "m1", recipients: [{ token: TOKEN_A }, { token: TOKEN_B }] }), auth, ip: "203.0.113.9" });
  expect(res.status).toBe(201);
  return { ...s, auth };
}
const events = async (s: Awaited<ReturnType<typeof registered>>, q = "") =>
  (await (await s.call(`/v1/events${q}`, { auth: s.auth })).json()) as { events: { kind: string; client: string | null; country: string | null; fingerprint: string; possiblyForwarded: boolean; id: number }[]; cursor: string };

describe("install and auth", () => {
  it("creates an install and stores only the hash", async () => {
    const s = setup();
    const res = await s.call("/v1/install", { method: "POST", ip: "1.1.1.1" });
    expect(res.status).toBe(201);
    const b = (await res.json()) as { installId: string; secret: string };
    const row = s.raw.prepare("SELECT secret_hash FROM installs WHERE id = ?").get(b.installId) as { secret_hash: string };
    expect(row.secret_hash).toHaveLength(64);
    expect(row.secret_hash).not.toContain(b.secret);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
  it("rate limits installs per IP at 10/hour", async () => {
    const s = setup();
    for (let i = 0; i < 10; i++) expect((await s.call("/v1/install", { method: "POST", ip: "2.2.2.2" })).status).toBe(201);
    const res = await s.call("/v1/install", { method: "POST", ip: "2.2.2.2" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    expect((await s.call("/v1/install", { method: "POST", ip: "3.3.3.3" })).status).toBe(201);
    expect((await s.call("/v1/install", { method: "POST", ip: "2.2.2.2", now: T0 + 3_700_000 })).status).toBe(201);
  });
  it("rejects missing, malformed, wrong and unknown credentials", async () => {
    const s = setup();
    const auth = await install(s.call);
    const [id] = auth.split(".");
    expect((await s.call("/v1/events")).status).toBe(401);
    expect((await s.call("/v1/events", { auth: "nope" })).status).toBe(401);
    expect((await s.call("/v1/events", { auth: `${id}.${"x".repeat(43)}` })).status).toBe(401);
    expect((await s.call("/v1/events", { auth: `unknownid1234.${"x".repeat(43)}` })).status).toBe(401);
    expect((await s.call("/v1/events", { auth })).status).toBe(200);
  });
});

describe("routing and errors", () => {
  it("404 and 405 with JSON errors", async () => {
    const s = setup();
    const nf = await s.call("/nope");
    expect(nf.status).toBe(404);
    expect(((await nf.json()) as { error: { code: string } }).error.code).toBe("not_found");
    const mna = await s.call("/v1/install", { method: "GET" });
    expect(mna.status).toBe(405);
    expect(mna.headers.get("Allow")).toBeTruthy();
    expect((await s.call("/v1/events", { method: "POST" })).status).toBe(405);
  });
  it("500 for unexpected failures, without detail", async () => {
    const s = setup();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    s.env.DB.prepare = () => { throw new Error("db exploded"); };
    const res = await s.call("/v1/install", { method: "POST", ip: "1.1.1.1" });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("exploded");
    err.mockRestore();
  });
});

describe("messages", () => {
  it("validates input", async () => {
    const s = setup();
    const auth = await install(s.call);
    const bad = async (body: string) => (await s.call("/v1/messages", { method: "POST", body, auth })).status;
    expect(await bad("not json")).toBe(400);
    expect(await bad(JSON.stringify({ ref: "", recipients: [] }))).toBe(400);
    expect(await bad(JSON.stringify({ ref: "r", recipients: [{ token: "short" }] }))).toBe(400);
    expect(await bad(JSON.stringify({ ref: "r", recipients: [{ token: TOKEN_A }, { token: TOKEN_A }] }))).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => ({ token: String(i).padStart(22, "A") }));
    expect(await bad(JSON.stringify({ ref: "r", recipients: many }))).toBe(400);
    const ok = Array.from({ length: 100 }, (_, i) => ({ token: String(i).padStart(22, "A") }));
    expect(await bad(JSON.stringify({ ref: "r", recipients: ok }))).toBe(201);
  });
  it("rejects oversized bodies", async () => {
    const s = setup();
    const auth = await install(s.call);
    const res = await s.call("/v1/messages", { method: "POST", body: "x".repeat(40_000), auth });
    expect(res.status).toBe(413);
    const res2 = await s.call("/v1/messages", { method: "POST", body: "x", auth, headers: { "Content-Length": "99999" } });
    expect(res2.status).toBe(413);
  });
  it("is idempotent for the same ref and conflicts on a token owned by another message", async () => {
    const s = await registered();
    const again = await s.call("/v1/messages", { ...post({ ref: "m1", recipients: [{ token: TOKEN_A }] }), auth: s.auth });
    expect(again.status).toBe(201);
    const other = await s.call("/v1/messages", { ...post({ ref: "m2", recipients: [{ token: TOKEN_A }] }), auth: s.auth });
    expect(other.status).toBe(409);
    const auth2 = await install(s.call, "9.9.9.9");
    const stolen = await s.call("/v1/messages", { ...post({ ref: "m1", recipients: [{ token: TOKEN_A }] }), auth: auth2 });
    expect(stolen.status).toBe(409);
  });
  it("DELETE stops tracking and removes events", async () => {
    const s = await registered();
    await s.call(`/i/${TOKEN_A}.gif`, { headers: { "User-Agent": "Mozilla/5.0 Chrome/126 Safari/537" }, ip: "5.5.5.5", now: T0 + 1_000_000 });
    expect((await events(s)).events).toHaveLength(1);
    expect((await s.call("/v1/messages/m1", { method: "DELETE", auth: s.auth })).status).toBe(200);
    const hit = await s.call(`/i/${TOKEN_A}.gif`, { headers: { "User-Agent": "Mozilla/5.0 Chrome/126 Safari/537" }, ip: "5.5.5.6", now: T0 + 2_000_000 });
    expect(hit.status).toBe(200);
    expect((await events(s)).events).toHaveLength(0);
    expect((await s.call("/v1/messages/m1", { method: "DELETE" })).status).toBe(401);
  });
});

describe("pixel", () => {
  const chrome = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" };
  it("returns the GIF for valid, unknown and malformed tokens, and with or without extension", async () => {
    const s = await registered();
    for (const p of [`/i/${TOKEN_A}.gif`, `/i/${TOKEN_A}`, "/i/ZZZZZZZZZZZZZZZZZZZZZZ.gif", "/i/short.gif", "/i/%00%00"]) {
      const r = await s.call(p, { headers: chrome, ip: "6.6.6.6" });
      expect(r.status).toBe(200);
      expect(r.headers.get("Content-Type")).toBe("image/gif");
      expect(new Uint8Array(await r.arrayBuffer())).toHaveLength(43);
    }
    expect((await events(s)).events).toHaveLength(2);
  });
  it("returns the GIF for other methods without recording", async () => {
    const s = await registered();
    expect((await s.call(`/i/${TOKEN_A}.gif`, { method: "POST", ip: "6.6.6.6" })).status).toBe(200);
    expect((await events(s)).events).toHaveLength(0);
  });
  it("records HEAD as scanner", async () => {
    const s = await registered();
    await s.call(`/i/${TOKEN_A}.gif`, { method: "HEAD", headers: chrome, ip: "6.6.6.6", now: T0 + 500_000 });
    expect((await events(s)).events[0]?.kind).toBe("scanner");
  });
  it("counts a Gmail proxy open and hides its location", async () => {
    const s = await registered();
    await s.call(`/i/${TOKEN_A}.gif`, { headers: { "User-Agent": GMAIL_UA }, ip: "66.249.1.1", cf: { asn: 15169, asOrganization: "Google LLC", country: "US", city: "Mountain View" }, now: T0 + 600_000 });
    const e = (await events(s)).events[0]!;
    expect(e).toMatchObject({ kind: "open", client: "Gmail", country: null });
  });
  it("stores country and city for direct clients, never raw IPs", async () => {
    const s = await registered();
    await s.call(`/i/${TOKEN_A}.gif`, { headers: chrome, ip: "198.18.0.77", cf: { asn: 7922, asOrganization: "Comcast", country: "US", city: "Seattle" }, now: T0 + 600_000 });
    expect((await events(s)).events[0]).toMatchObject({ kind: "open", country: "US" });
    const dump = JSON.stringify(s.raw.prepare("SELECT * FROM events").all()) + JSON.stringify(s.raw.prepare("SELECT * FROM sender_fingerprints").all());
    expect(dump).not.toContain("198.18.0.77");
    expect(dump).not.toContain("203.0.113.9");
  });
  it("classifies Apple relay IPs as prefetch", async () => {
    const s = await registered();
    await s.call(`/i/${TOKEN_A}.gif`, { headers: { "User-Agent": "Mozilla/5.0" }, ip: "172.224.226.5", now: T0 + 5000 });
    expect((await events(s)).events[0]?.kind).toBe("prefetch");
  });
  it("marks the registering IP as self, and /v1/seen pings too", async () => {
    const s = await registered();
    await s.call(`/i/${TOKEN_A}.gif`, { headers: chrome, ip: "203.0.113.9", now: T0 + 600_000 });
    expect((await events(s)).events[0]?.kind).toBe("self");
    expect((await s.call("/v1/seen", { method: "POST", auth: s.auth, ip: "192.0.2.50", now: T0 + 1_000_000 })).status).toBe(200);
    await s.call(`/i/${TOKEN_B}.gif`, { headers: chrome, ip: "192.0.2.50", now: T0 + 1_100_000 });
    expect((await events(s)).events[1]?.kind).toBe("self");
  });
  it("sender fingerprints expire after 24h", async () => {
    const s = await registered();
    await s.call(`/i/${TOKEN_A}.gif`, { headers: chrome, ip: "203.0.113.9", now: T0 + 25 * 3600_000 });
    expect((await events(s)).events[0]?.kind).toBe("open");
  });
  it("flags duplicates and possible forwards", async () => {
    const s = await registered();
    await s.call(`/i/${TOKEN_A}.gif`, { headers: { "User-Agent": GMAIL_UA }, ip: "66.249.1.1", cf: { asn: 15169, asOrganization: "Google LLC" }, now: T0 + 600_000 });
    await s.call(`/i/${TOKEN_A}.gif`, { headers: { "User-Agent": GMAIL_UA }, ip: "66.249.1.2", cf: { asn: 15169, asOrganization: "Google LLC" }, now: T0 + 603_000 });
    await s.call(`/i/${TOKEN_A}.gif`, { headers: chrome, ip: "198.18.0.5", cf: { asn: 7922, asOrganization: "Comcast" }, now: T0 + 3 * 3600_000 });
    const ev = (await events(s)).events;
    expect(ev.map((e) => e.kind)).toEqual(["open", "duplicate", "open"]);
    expect(ev[2]?.possiblyForwarded).toBe(true);
    expect(ev[0]?.possiblyForwarded).toBe(false);
  });
  it("caps events per token", async () => {
    const s = await registered();
    const ins = s.raw.prepare("INSERT INTO events (token, install_id, at, kind, fingerprint) VALUES (?, (SELECT install_id FROM tokens WHERE token = ?), 1, 'bot', 'f')");
    for (let i = 0; i < 300; i++) ins.run(TOKEN_A, TOKEN_A);
    await s.call(`/i/${TOKEN_A}.gif`, { headers: chrome, ip: "7.7.7.7", now: T0 + 600_000 });
    expect((s.raw.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(300);
  });
  it("never errors visibly when the database fails", async () => {
    const s = await registered();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    s.env.DB.prepare = () => { throw new Error("down"); };
    const r = await s.call(`/i/${TOKEN_A}.gif`, { headers: chrome, ip: "7.7.7.7" });
    expect(r.status).toBe(200);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("events", () => {
  const chrome = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" };
  it("pages by cursor, scopes to the install, and re-hashes fingerprints per install", async () => {
    const s = await registered();
    for (let i = 0; i < 3; i++) await s.call(`/i/${TOKEN_A}.gif`, { headers: chrome, ip: `10.0.0.${i}`, now: T0 + 600_000 + i * 20_000 });
    const page1 = await events(s, "?limit=2");
    expect(page1.events).toHaveLength(2);
    const page2 = await events(s, `?after=${page1.cursor}&limit=2`);
    expect(page2.events).toHaveLength(1);
    expect((await events(s, `?after=${page2.cursor}`)).events).toHaveLength(0);
    expect((await events(s, `?after=${page2.cursor}`)).cursor).toBe(page2.cursor);
    const raw = s.raw.prepare("SELECT fingerprint FROM events").all() as { fingerprint: string }[];
    expect(raw.map((r) => r.fingerprint)).not.toContain(page1.events[0]?.fingerprint);
    const other = await install(s.call, "9.9.9.9");
    const theirs = (await (await s.call("/v1/events", { auth: other })).json()) as { events: unknown[] };
    expect(theirs.events).toHaveLength(0);
  });
  it("rejects bad query params", async () => {
    const s = await registered();
    expect((await s.call("/v1/events?limit=0", { auth: s.auth })).status).toBe(400);
    expect((await s.call("/v1/events?limit=501", { auth: s.auth })).status).toBe(400);
    expect((await s.call("/v1/events?after=-1", { auth: s.auth })).status).toBe(400);
    expect((await s.call("/v1/events?after=abc", { auth: s.auth })).status).toBe(400);
  });
});

describe("cron", () => {
  it("purges old events, messages and sender fingerprints", async () => {
    const s = await registered();
    const day = 86_400_000;
    s.raw.prepare("INSERT INTO events (token, install_id, at, kind, fingerprint) VALUES (?, 'x', ?, 'open', 'f')").run(TOKEN_A, T0 - 200 * day);
    s.raw.prepare("INSERT INTO events (token, install_id, at, kind, fingerprint) VALUES (?, 'x', ?, 'open', 'f')").run(TOKEN_A, T0);
    await purge(s.env, T0 + 2 * day);
    expect((s.raw.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(1);
    expect((s.raw.prepare("SELECT COUNT(*) AS n FROM sender_fingerprints").get() as { n: number }).n).toBe(0);
    await purge(s.env, T0 + 200 * day);
    expect((s.raw.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n).toBe(0);
    expect((s.raw.prepare("SELECT COUNT(*) AS n FROM tokens").get() as { n: number }).n).toBe(0);
  });
  it("worker.scheduled runs the purge", async () => {
    const s = setup();
    const waits: Promise<unknown>[] = [];
    worker.scheduled({} as ScheduledController, s.env, { waitUntil: (p: Promise<unknown>) => waits.push(p) } as unknown as ExecutionContext);
    await Promise.all(waits);
    expect(waits).toHaveLength(1);
  });
  it("worker.fetch delegates to the router", async () => {
    const s = setup();
    const r = await worker.fetch(new Request("https://r.test/nope"), s.env, { waitUntil() {} } as unknown as ExecutionContext);
    expect(r.status).toBe(404);
  });
});
