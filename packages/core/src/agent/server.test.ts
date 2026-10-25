import { request } from "node:http";
import { statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FlintError, type Settings } from "../types";
import { currentAgent } from "./context";
import { startAgentServer, type AgentServerHandle } from "./server";
import { activityLog, fakeApi, rawRequest, settings, tempDir } from "./test-helpers";

let handle: AgentServerHandle | null = null;
afterEach(async () => { await handle?.close(); handle = null; });

async function boot(opts: { api?: ReturnType<typeof fakeApi>; settings?: Settings; keepaliveMs?: number; callAs?: never } = {}) {
  const dir = tempDir();
  const act = activityLog();
  const api = opts.api ?? fakeApi();
  const cfg = { value: opts.settings ?? settings() };
  handle = await startAgentServer({
    api, socketPath: join(dir, "a.sock"), tokenPath: join(dir, "tok"),
    getSettings: () => cfg.value, logActivity: act.log, keepaliveMs: opts.keepaliveMs,
  });
  const call = (body: unknown, token: string | undefined = handle!.token) =>
    rawRequest(handle!.socketPath, "POST", "/v1/call", { token, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { api, act, cfg, dir, call, h: handle! };
}

describe("agent server", () => {
  it("creates a 32-byte hex token and a 600 socket", async () => {
    const { h, dir } = await boot();
    expect(h.token).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(join(dir, "tok")).mode & 0o777).toBe(0o600);
    expect(statSync(h.socketPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, "tok"), "utf8")).toBe(h.token);
  });

  it("reuses an existing token and replaces a stale socket", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "tok"), "a".repeat(64));
    writeFileSync(join(dir, "a.sock"), "stale");
    handle = await startAgentServer({ api: fakeApi(), socketPath: join(dir, "a.sock"), tokenPath: join(dir, "tok"), getSettings: () => settings(), logActivity: () => {} });
    expect(handle.token).toBe("a".repeat(64));
    const r = await rawRequest(handle.socketPath, "POST", "/v1/call", { token: handle.token, body: JSON.stringify({ method: "listAccounts" }) });
    expect(r.status).toBe(200);
  });

  it("rejects missing and wrong tokens", async () => {
    const { call, act } = await boot();
    expect((await call({ method: "listAccounts" }, "")).status).toBe(401);
    const r = await call({ method: "listAccounts" }, "x".repeat(64));
    expect(r.status).toBe(401);
    expect(r.json).toMatchObject({ ok: false, error: { code: "auth" } });
    expect(act.entries).toHaveLength(0);
  });

  it("validates the body and method", async () => {
    const { call, h } = await boot();
    expect((await call("not json")).status).toBe(400);
    expect((await call({ params: [] })).status).toBe(400);
    expect((await call({ method: "dropTables" })).json).toMatchObject({ error: { code: "invalid" } });
    expect((await rawRequest(h.socketPath, "GET", "/nope", { token: h.token })).status).toBe(404);
  });

  it("rejects bodies over 10MB", async () => {
    const { h } = await boot();
    const status = await new Promise<number>((resolve) => {
      const req = request({ socketPath: h.socketPath, method: "POST", path: "/v1/call", headers: { authorization: `Bearer ${h.token}` } }, (res) => { res.on("error", () => {}); res.resume(); resolve(res.statusCode ?? 0); });
      req.on("error", () => resolve(0));
      req.socket?.on("error", () => {});
      req.on("socket", (sock) => sock.on("error", () => {}));
      req.write(Buffer.alloc(11 * 1024 * 1024, 97));
      req.end();
    });
    expect([413, 0]).toContain(status);
  });

  it("dispatches calls with params and logs a summary", async () => {
    const api = fakeApi({ archive: () => ({ undoToken: "u1" }) });
    const { call, act } = await boot({ api });
    const r = await call({ method: "archive", params: [[1, 2, 3]], agent: "claude" });
    expect(r.json).toEqual({ ok: true, result: { undoToken: "u1" } });
    expect(api.calls).toEqual([{ method: "archive", params: [[1, 2, 3]] }]);
    expect(act.entries[0]).toMatchObject({ agent: "claude", method: "archive", summary: "Archived 3 threads", status: "ok" });
  });

  it("returns null for void results and defaults the agent name", async () => {
    const { call, act } = await boot();
    const r = await call({ method: "syncNow" });
    expect(r.json).toEqual({ ok: true, result: null });
    expect(act.entries[0]?.agent).toBe("agent");
  });

  it("exposes the caller to the service through callAs", async () => {
    let seen: string | undefined;
    const api = fakeApi({ listAccounts: () => { seen = currentAgent(); return []; } });
    const { call } = await boot({ api });
    await call({ method: "listAccounts", agent: "codex" });
    expect(seen).toBe("codex");
    expect(currentAgent()).toBeUndefined();
  });

  it("uses a custom callAs hook", async () => {
    const dir = tempDir();
    const names: string[] = [];
    handle = await startAgentServer({
      api: fakeApi(), socketPath: join(dir, "a.sock"), tokenPath: join(dir, "t"),
      getSettings: () => settings(), logActivity: () => {},
      callAs: (agent, fn) => { names.push(agent); return fn(); },
    });
    await rawRequest(handle.socketPath, "POST", "/v1/call", { token: handle.token, body: JSON.stringify({ method: "listAccounts", agent: "grok" }) });
    expect(names).toEqual(["grok"]);
  });

  it("never allows admin methods", async () => {
    const { call, api, act } = await boot();
    const r = await call({ method: "removeAccount", params: ["a"] });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: { code: "permission" } });
    expect(api.calls).toHaveLength(0);
    expect(act.entries[0]).toMatchObject({ status: "denied" });
  });

  it("honors settings.agents.modify", async () => {
    const { call, api, act } = await boot({ settings: settings({ modify: "deny" }) });
    expect((await call({ method: "archive", params: [[1]] })).status).toBe(403);
    expect((await call({ method: "listThreads", params: [{ view: "inbox" }] })).status).toBe(200);
    expect(api.calls.map((c) => c.method)).toEqual(["listThreads"]);
    expect(act.entries.map((e) => e.status)).toEqual(["denied", "ok"]);
  });

  it("honors settings.agents.send", async () => {
    const denied = await boot({ settings: settings({ send: "deny" }) });
    expect((await denied.call({ method: "sendDraft", params: [1] })).status).toBe(403);
    await handle?.close();
    const ask = await boot({
      settings: settings({ send: "ask" }),
      api: fakeApi({
        getDraft: () => ({ id: 1, to: [{ name: "", address: "cindy@example.com" }] }),
        sendDraft: () => ({ scheduledId: 5, sendAt: 1, undoUntil: 1, status: "awaiting_approval" }),
      }),
    });
    const r = await ask.call({ method: "sendDraft", params: [1] });
    expect(r.status).toBe(200);
    expect(ask.act.entries[0]).toMatchObject({ status: "awaiting_approval", summary: "Queued mail to cindy@example.com for approval", detail: { scheduledId: 5 } });
  });

  it("rejects everything when agents are disabled, and reads settings per call", async () => {
    const { call, cfg, act } = await boot({ settings: settings({ enabled: false }) });
    const r = await call({ method: "listAccounts" });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.json)).toContain("Agent access is off");
    expect(act.entries).toHaveLength(0);
    cfg.value = settings();
    expect((await call({ method: "listAccounts" })).status).toBe(200);
  });

  it("maps FlintError to its code and status", async () => {
    const api = fakeApi({ getThread: () => { throw new FlintError("not_found", "No such thread."); } });
    const { call, act } = await boot({ api });
    const r = await call({ method: "getThread", params: [9] });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ ok: false, error: { code: "not_found", message: "No such thread." } });
    expect(act.entries[0]).toMatchObject({ status: "error" });
  });

  it("hides internal error details", async () => {
    const api = fakeApi({ getThread: () => { throw new Error("SQLITE: secret path /x"); } });
    const { call } = await boot({ api });
    const r = await call({ method: "getThread", params: [9] });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toContain("SQLITE");
  });

  it("keeps bodies out of activity detail", async () => {
    const { call, act } = await boot();
    await call({ method: "createDraft", params: [{ mode: "new", to: [{ name: "", address: "a@b.co" }], html: "<p>secret body</p>" }] });
    expect(JSON.stringify(act.entries[0]?.detail)).not.toContain("secret body");
    expect(act.entries[0]?.summary).toBe("Created draft to a@b.co");
  });

  it("survives a failing logActivity", async () => {
    const dir = tempDir();
    handle = await startAgentServer({ api: fakeApi(), socketPath: join(dir, "s"), tokenPath: join(dir, "t"), getSettings: () => settings(), logActivity: () => { throw new Error("db down"); } });
    const r = await rawRequest(handle.socketPath, "POST", "/v1/call", { token: handle.token, body: JSON.stringify({ method: "listAccounts" }) });
    expect(r.status).toBe(200);
  });

  describe("events", () => {
    function open(h: AgentServerHandle, token = h.token) {
      return new Promise<{ status: number; chunks: string[]; close(): void }>((resolve) => {
        const chunks: string[] = [];
        const req = request({ socketPath: h.socketPath, method: "GET", path: "/v1/events?agent=t", headers: { authorization: `Bearer ${token}` } }, (res) => {
          res.setEncoding("utf8");
          res.on("data", (c: string) => chunks.push(c));
          resolve({ status: res.statusCode ?? 0, chunks, close: () => req.destroy() });
        });
        req.on("error", () => {});
        req.end();
      });
    }
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it("streams events, filters settings and foreign ai runs, sends keepalives, and cleans up", async () => {
      const api = fakeApi({ aiRun: () => ({ runId: "mine" }) });
      const subs: boolean[] = [];
      const dir = tempDir();
      handle = await startAgentServer({
        api, socketPath: join(dir, "s"), tokenPath: join(dir, "t"), getSettings: () => settings(), logActivity: () => {},
        keepaliveMs: 30, onEventSubscribe: (i) => subs.push(i.open),
      });
      await rawRequest(handle.socketPath, "POST", "/v1/call", { token: handle.token, body: JSON.stringify({ method: "aiRun", params: [{ kind: "summarize", threadId: 1 }] }) });
      const s = await open(handle);
      expect(s.status).toBe(200);
      await wait(20);
      api.emit({ type: "toast", level: "info", message: "hi", undoToken: "secret-undo" });
      api.emit({ type: "settings", settings: settings() });
      api.emit({ type: "ai", chunk: { runId: "other", type: "text", text: "x" } });
      api.emit({ type: "ai", chunk: { runId: "mine", type: "text", text: "y" } });
      await wait(80);
      const text = s.chunks.join("");
      expect(text).toContain('"type":"toast"');
      expect(text).toContain('"runId":"mine"');
      expect(text).not.toContain("secret-undo");
      expect(text).not.toContain('"type":"settings"');
      expect(text).not.toContain('"runId":"other"');
      expect(text).toContain(": keepalive");
      expect(api.listeners).toBe(1);
      s.close();
      await wait(50);
      expect(api.listeners).toBe(0);
      expect(subs).toEqual([true, false]);
    });

    it("ends open streams when agents are turned off", async () => {
      const api = fakeApi();
      const cfg = { value: settings() };
      const dir = tempDir();
      handle = await startAgentServer({ api, socketPath: join(dir, "s"), tokenPath: join(dir, "t"), getSettings: () => cfg.value, logActivity: () => {}, keepaliveMs: 1000 });
      const ended = new Promise<void>((resolve) => {
        const req = request({ socketPath: handle!.socketPath, method: "GET", path: "/v1/events", headers: { authorization: `Bearer ${handle!.token}` } }, (res) => {
          res.resume();
          res.on("end", resolve);
          res.on("close", resolve);
        });
        req.on("error", () => {});
        req.end();
      });
      await wait(30);
      cfg.value = settings({ enabled: false });
      api.emit({ type: "toast", level: "info", message: "after off" });
      await Promise.race([ended, wait(500).then(() => { throw new Error("stream stayed open"); })]);
      await wait(20);
      expect(api.listeners).toBe(0);
    });

    it("requires auth and enabled agents", async () => {
      const { h, cfg } = await boot();
      expect((await open(h, "nope")).status).toBe(401);
      cfg.value = settings({ enabled: false });
      expect((await open(h)).status).toBe(403);
    });
  });

  it("refuses unsubscribe for agents when sending needs approval", async () => {
    const ask = await boot({ settings: settings({ send: "ask" }) });
    const r = await ask.call({ method: "unsubscribe", params: [5] });
    expect(r.status).toBe(403);
    expect(ask.api.calls).toHaveLength(0);
    expect(ask.act.entries[0]).toMatchObject({ status: "denied" });
    await ask.h.close();
    const allow = await boot({ api: fakeApi({ unsubscribe: () => ({ method: "one_click" }) }), settings: settings({ send: "allow" }) });
    expect((await allow.call({ method: "unsubscribe", params: [5] })).status).toBe(200);
    await allow.h.close();
    const deny = await boot({ settings: settings({ send: "deny" }) });
    expect((await deny.call({ method: "unsubscribe", params: [5] })).status).toBe(403);
  });

  it("removes the socket on close", async () => {
    const { h } = await boot();
    await h.close();
    expect(existsSync(h.socketPath)).toBe(false);
    handle = null;
  });
});
