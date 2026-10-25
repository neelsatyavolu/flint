import { afterEach, describe, expect, it, vi } from "vitest";
import { isApplePrivateRelayIp, parseEgressCsv, SNAPSHOT_RANGES } from "./apple";
import { loadAppleRanges, refreshAppleRanges, resetAppleRangesCache } from "./apple-refresh";
import { runDaily } from "./cron";
import { AUTHED_IP_LIMIT_PER_HOUR } from "./env";
import { install, setup, T0, TOKEN_A } from "./test/helpers";

afterEach(() => { resetAppleRangesCache(); vi.restoreAllMocks(); });

/** A CSV big enough to pass the sanity floor: every snapshot v4 block plus one new block and a new v6 prefix. */
function bigCsv(extra: string[] = []): string {
  const lines = [...SNAPSHOT_RANGES.v4].map((n) => `${n >> 16}.${(n >> 8) & 255}.${n & 255}.0/24,US,US-CA,Los Angeles,`);
  return [...lines, "2a02:26f7:b000::/48,US,US-CA,Los Angeles,", ...extra].join("\n");
}
const csvResponse = (body: string, status = 200) => async () => new Response(body, { status });

describe("apple egress refresh", () => {
  it("parses v4 and v6 rows and skips junk", () => {
    const p = parseEgressCsv("172.224.226.0/27,US\n2a02:26f7:b000::/48,US\n,\nnot a cidr\n10.0.0.0/8,US\n");
    expect(p.v4.has(172 * 65536 + 224 * 256 + 226)).toBe(true);
    expect(p.v4.size).toBe(1);
    expect([...p.v6]).toEqual(["2a0226f7b"]);
    expect(p.lines).toBe(2);
  });

  it("stores a new list in D1 and uses it for classification", async () => {
    const s = setup();
    expect(isApplePrivateRelayIp("203.0.113.9", await loadAppleRanges(s.env, T0))).toBe(false);
    resetAppleRangesCache();
    expect(await refreshAppleRanges(s.env, T0, csvResponse(bigCsv(["203.0.113.0/24,US"])) as typeof fetch)).toBe(true);
    const ranges = await loadAppleRanges(s.env, T0 + 1);
    expect(isApplePrivateRelayIp("203.0.113.9", ranges)).toBe(true);
    expect(isApplePrivateRelayIp("172.224.226.5", ranges)).toBe(true);
  });

  it("keeps the old data when the download is small, broken or failing", async () => {
    const s = setup();
    expect(await refreshAppleRanges(s.env, T0, csvResponse("203.0.113.0/24,US\n") as typeof fetch)).toBe(false);
    await expect(refreshAppleRanges(s.env, T0, csvResponse("", 503) as typeof fetch)).rejects.toThrow("503");
    expect(s.raw.prepare("SELECT COUNT(*) AS n FROM apple_ranges").get()).toEqual({ n: 0 });
    expect(isApplePrivateRelayIp("203.0.113.9", await loadAppleRanges(s.env, T0))).toBe(false);
  });

  it("falls back to the snapshot when the table is empty, corrupt or missing", async () => {
    const s = setup();
    expect(await loadAppleRanges(s.env, T0)).toBe(SNAPSHOT_RANGES);
    resetAppleRangesCache();
    s.raw.prepare("INSERT INTO apple_ranges VALUES ('v4', 'not json', 1), ('v6', '[]', 1)").run();
    expect(await loadAppleRanges(s.env, T0)).toBe(SNAPSHOT_RANGES);
    resetAppleRangesCache();
    s.raw.exec("DROP TABLE apple_ranges");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadAppleRanges(s.env, T0)).toBe(SNAPSHOT_RANGES);
  });

  it("the daily job still purges when the refresh fails", async () => {
    const s = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    s.raw.prepare("INSERT INTO installs (id, secret_hash, created_at) VALUES ('old', 'h', ?)").run(T0 - 400 * 86_400_000);
    await runDaily(s.env, T0, (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect(s.raw.prepare("SELECT COUNT(*) AS n FROM installs").get()).toEqual({ n: 0 });
  });

  it("a refreshed range changes how a pixel hit is classified", async () => {
    const s = setup();
    const auth = await install(s.call);
    await s.call("/v1/messages", { method: "POST", body: JSON.stringify({ ref: "m1", recipients: [{ token: TOKEN_A }] }), auth, ip: "198.51.100.77" });
    await refreshAppleRanges(s.env, T0, csvResponse(bigCsv(["203.0.113.0/24,US"])) as typeof fetch);
    await s.call(`/i/${TOKEN_A}.gif`, { headers: { "User-Agent": "Mozilla/5.0 Chrome/126 Safari/537" }, ip: "203.0.113.9", now: T0 + 1_000_000 });
    const row = s.raw.prepare("SELECT kind FROM events").get() as { kind: string };
    expect(row.kind).toBe("prefetch");
  });
});

describe("per-IP limits and DELETE", () => {
  it("limits authenticated endpoints per IP, before credentials are checked", async () => {
    const s = setup();
    const auth = await install(s.call);
    const ip = "192.0.2.50";
    // Seed the counter just below the limit instead of making 1500 requests.
    expect((await s.call("/v1/seen", { method: "POST", auth, ip })).status).toBe(200);
    s.raw.prepare("UPDATE rate_limits SET count = ? WHERE key LIKE 'ip:%'").run(AUTHED_IP_LIMIT_PER_HOUR - 1);
    expect((await s.call("/v1/events", { auth, ip })).status).toBe(200);
    expect((await s.call("/v1/events", { auth, ip })).status).toBe(429);
    expect((await s.call("/v1/events", { auth: "bad.credentialsxxxxxxxxxx", ip })).status).toBe(429);
    expect((await s.call("/v1/events", { auth, ip: "192.0.2.51" })).status).toBe(200);
    expect((await s.call("/v1/events", { auth, ip, now: T0 + 3_700_000 })).status).toBe(200);
  });

  it("DELETE returns 202 instead of 500 when storage fails, and 400 for huge refs", async () => {
    const s = setup();
    const auth = await install(s.call);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await s.call(`/v1/messages/${"a".repeat(300)}`, { method: "DELETE", auth })).status).toBe(400);
    s.raw.exec("DROP TABLE events");
    const res = await s.call("/v1/messages/m1", { method: "DELETE", auth });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: false, deleted: false });
    expect((await s.call("/v1/messages/m1", { method: "DELETE" })).status).toBe(401);
  });

  it("DELETE does not 500 when the database is entirely down", async () => {
    const s = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    s.env.DB.prepare = () => { throw new Error("down"); };
    expect((await s.call("/v1/messages/m1", { method: "DELETE", auth: "abcdefgh.abcdefghijklmnop" })).status).toBe(202);
  });
});
