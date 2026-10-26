import { mkdtempSync, rmSync, statSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentPaths } from "../agent/paths";
import { codesPaths } from "../codes/contract";
import { createCodeRegistry } from "../codes/registry";
import { startCodesServer } from "../codes/server";
import type { NotifyRequest } from "../platform";
import { DEFAULT_SETTINGS } from "../store/settings";
import { makeStore, msg, person, seedImap } from "../store/testkit";
import type { FlintEvent, Settings } from "../types";
import { badgeFor, codeAlertCovers, codesApi, wireCodes } from "./codes";
import type { ServiceContext } from "./context";
import { EventBus } from "./events";
import { wireNotifications } from "./notify";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const MIN = 60_000;

function setup(codes: Partial<Settings["codes"]> = {}, caller?: string) {
  const store = makeStore();
  const seed = seedImap(store);
  const bus = new EventBus();
  const events: FlintEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const notified: NotifyRequest[] = [];
  const copied: [string, number][] = [];
  const settings: Settings = { ...DEFAULT_SETTINGS, codes: { ...DEFAULT_SETTINGS.codes, ...codes } };
  const ctx = {
    store, bus, emit: bus.emit, now: () => NOW, caller: () => caller, codes: createCodeRegistry(() => NOW),
    getSettings: () => settings,
    platform: { dataDir: "/nonexistent", notify: (n: NotifyRequest) => notified.push(n), copyText: (t: string, ms: number) => copied.push([t, ms]) },
  } as unknown as ServiceContext;
  const arrive = (over: Parameters<typeof msg>[0], folder = seed.inbox) => {
    const [o] = store.ingestMessages(seed.account.id, folder.id, [msg(over)], { evaluate: true });
    bus.emit({ type: "new_mail", accountId: seed.account.id, threadId: o!.threadId, from: person("x"), subject: over.subject ?? "", category: "people" });
    return o!;
  };
  return { store, seed, bus, ctx, events, notified, copied, arrive, unwire: wireCodes(ctx) };
}

const kayak = { uid: 1, subject: "530331 is your KAYAK verification code", from: [person("KAYAK", "no-reply@mail.kayak.com")], date: NOW - MIN };

describe("wireCodes", () => {
  it("registers a code from fresh inbox mail, emits, notifies with a copy action", () => {
    const t = setup();
    const o = t.arrive(kayak);
    const [c] = t.ctx.codes.list();
    expect(c).toMatchObject({ code: "530331", service: "KAYAK", senderDomain: "kayak.com", threadId: o.threadId, messageId: o.messageRowId, used: false, receivedAt: NOW - MIN });
    expect(t.events.find((e) => e.type === "code")).toMatchObject({ code: { code: "530331" } });
    expect(t.notified).toEqual([expect.objectContaining({ title: "KAYAK code 530331", copyText: "530331", threadId: o.threadId })]);
    expect(t.copied).toEqual([]);
  });

  it("copies automatically only when asked, with the 90 second clear", () => {
    const t = setup({ autoCopy: true });
    t.arrive(kayak);
    expect(t.copied).toEqual([["530331", 90_000]]);
  });

  it("keeps the code out of notifications when previews are off", () => {
    const t = setup();
    (t.ctx as { getSettings: () => Settings }).getSettings = () => ({ ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications, preview: "none" } });
    t.arrive(kayak);
    expect(t.ctx.codes.list()).toHaveLength(1);
    expect(t.notified).toEqual([]);
    expect(codeAlertCovers(t.ctx, t.ctx.codes.list()[0]!.threadId)).toBe(false);
  });

  it("follows the notification master switch, scope none and per-account mute; auto-copy skips muted accounts and no-preview", () => {
    const variants = (t: ReturnType<typeof setup>): Array<Partial<Settings["notifications"]>> => [
      { enabled: false }, { scope: "none" }, { disabledAccounts: [t.seed.account.id] },
    ];
    for (const index of [0, 1, 2]) {
      const t = setup({ autoCopy: true });
      (t.ctx as { getSettings: () => Settings }).getSettings = () => ({
        ...DEFAULT_SETTINGS, codes: { ...DEFAULT_SETTINGS.codes, autoCopy: true },
        notifications: { ...DEFAULT_SETTINGS.notifications, ...variants(t)[index]! },
      });
      t.arrive(kayak);
      expect(t.ctx.codes.list()).toHaveLength(1);
      expect(t.notified, `variant ${index}`).toEqual([]);
      expect(codeAlertCovers(t.ctx, t.ctx.codes.list()[0]!.threadId)).toBe(false);
      // Muting the account also stops the clipboard; the master switch alone does not (auto-copy is its own setting).
      expect(t.copied).toHaveLength(index === 2 ? 0 : 1);
    }
    const p = setup({ autoCopy: true });
    (p.ctx as { getSettings: () => Settings }).getSettings = () => ({
      ...DEFAULT_SETTINGS, codes: { ...DEFAULT_SETTINGS.codes, autoCopy: true }, notifications: { ...DEFAULT_SETTINGS.notifications, preview: "none" },
    });
    p.arrive(kayak);
    expect(p.copied).toEqual([]);
  });

  it("respects the switches", () => {
    const off = setup({ enabled: false });
    off.arrive(kayak);
    expect(off.ctx.codes.list()).toEqual([]);
    const quiet = setup({ notify: false });
    quiet.arrive(kayak);
    expect(quiet.ctx.codes.list()).toHaveLength(1);
    expect(quiet.notified).toEqual([]);
  });

  it("ignores mail older than 15 minutes, spam, mail from me, blocked senders and mail without a code", () => {
    const t = setup();
    t.arrive({ ...kayak, uid: 1, date: NOW - 16 * MIN });
    t.arrive({ ...kayak, uid: 2 }, t.seed.spam);
    t.arrive({ ...kayak, uid: 3, from: [{ name: "Me", address: "me@example.com" }] });
    t.store.blockSender("blocked.example");
    t.arrive({ ...kayak, uid: 4, from: [person("B", "a@blocked.example")] });
    t.arrive({ uid: 5, subject: "Lunch?", date: NOW - MIN });
    t.arrive({ ...kayak, uid: 6, flags: { seen: true, flagged: false, answered: false, draft: false } });
    expect(t.ctx.codes.list()).toEqual([]);
    expect(t.notified).toEqual([]);
  });

  it("detects a code in an HTML-only body and does not register the same message twice", () => {
    const t = setup();
    const o = t.arrive({ uid: 1, subject: "Sign in", from: [person("Foo", "a@foo.com")], date: NOW - MIN, htmlBody: "<p>Your verification code is: 448930</p>" });
    t.bus.emit({ type: "new_mail", accountId: t.seed.account.id, threadId: o.threadId, from: person("x"), subject: "Sign in", category: "people" });
    t.bus.emit({ type: "new_mail", accountId: t.seed.account.id, threadId: o.threadId, from: person("x"), subject: "Sign in", category: "people" });
    expect(t.ctx.codes.list().map((c) => c.code)).toEqual(["448930"]);
    expect(t.events.filter((e) => e.type === "code")).toHaveLength(1);
  });

  it("recentCodes and markCodeUsed work and refresh the thread", async () => {
    const t = setup();
    t.arrive(kayak);
    const api = codesApi(t.ctx);
    const [c] = await api.recentCodes();
    t.events.length = 0;
    await api.markCodeUsed(c!.id);
    expect((await api.recentCodes())[0]!.used).toBe(true);
    expect(t.events).toEqual([expect.objectContaining({ type: "mail_changed", threadIds: [c!.threadId] })]);
  });

  it("drops the ordinary new-mail alert for a thread that got a code alert", () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const unwireNotify = wireNotifications({ ...t.ctx, bus: t.bus } as ServiceContext);
      t.arrive(kayak);
      vi.advanceTimersByTime(3000);
      expect(t.notified.map((n) => n.title)).toEqual(["KAYAK code 530331"]);
      unwireNotify();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("badges", () => {
  it("attach to the thread and message for the app, never for an agent, and vanish at expiry", () => {
    const t = setup();
    const o = t.arrive(kayak);
    expect(badgeFor(t.ctx, { threadId: o.threadId })).toMatchObject({ code: "530331", service: "KAYAK", used: false });
    expect(badgeFor(t.ctx, { messageId: o.messageRowId })?.code).toBe("530331");
    expect(badgeFor({ ...t.ctx, caller: () => "claude" } as ServiceContext, { threadId: o.threadId })).toBeUndefined();
    let clock = NOW;
    const aged = { ...t.ctx, codes: createCodeRegistry(() => clock) } as ServiceContext;
    aged.codes.add({ code: "111111", service: "S", senderAddress: "a@s.com", senderDomain: "s.com", threadId: 9, messageId: 9, accountId: "a", receivedAt: NOW });
    clock += 11 * MIN;
    expect(badgeFor(aged, { threadId: 9 })).toBeUndefined();
  });
});

describe("codes socket", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  async function start(enabled = true) {
    const dir = mkdtempSync(join(tmpdir(), "fc-"));
    dirs.push(dir);
    const paths = codesPaths(dir);
    const registry = createCodeRegistry();
    const used: string[] = [];
    const server = await startCodesServer({ paths, registry, isEnabled: () => enabled, onUsed: (c) => used.push(c.id) });
    const token = (await import("node:fs")).readFileSync(paths.tokenPath, "utf8").trim();
    const talk = (lines: unknown[]) => new Promise<unknown[]>((resolve) => {
      const out: unknown[] = [];
      const s = connect(paths.socketPath);
      let buf = "";
      s.setEncoding("utf8");
      s.on("connect", () => { for (const l of lines) s.write(`${typeof l === "string" ? l : JSON.stringify(l)}\n`); });
      s.on("data", (d: string) => {
        buf += d;
        const parts = buf.split("\n"); buf = parts.pop()!;
        for (const p of parts) out.push(JSON.parse(p));
        if (out.length >= lines.length) { s.end(); }
      });
      s.on("close", () => resolve(out));
    });
    const add = () => registry.add({ code: "123456", service: "Foo", senderAddress: "a@foo.com", senderDomain: "foo.com", threadId: 1, messageId: 2, accountId: "a1", receivedAt: Date.now() });
    return { server, paths, registry, token, talk, add, used, dir };
  }

  it("is private: 0600 socket, 0600 token separate from the agent token", async () => {
    const t = await start();
    expect(statSync(t.paths.socketPath).mode & 0o777).toBe(0o600);
    expect(statSync(t.paths.tokenPath).mode & 0o777).toBe(0o600);
    expect(t.paths.tokenPath).not.toBe(agentPaths(t.dir).tokenPath);
    await t.server.close();
  });

  it("requires the token hello first", async () => {
    const t = await start();
    t.add();
    expect(await t.talk([{ id: 1, op: "list" }])).toEqual([{ id: 1, ok: false, error: { code: "auth", message: expect.any(String) } }]);
    expect(await t.talk([{ id: 1, op: "hello", token: "wrong" }])).toMatchObject([{ ok: false, error: { code: "auth" } }]);
    expect(await t.talk(["not json"])).toMatchObject([{ ok: false, error: { code: "auth" } }]);
    await t.server.close();
  });

  it("lists wire codes only (no thread, message or account ids) and marks used", async () => {
    const t = await start();
    const c = t.add();
    const [hello, list] = await t.talk([{ id: 1, op: "hello", token: t.token }, { id: 2, op: "list", origin: "https://foo.com" }]);
    expect(hello).toEqual({ id: 1, ok: true });
    expect(list).toEqual({ id: 2, ok: true, codes: [{ id: c.id, code: "123456", service: "Foo", senderDomain: "foo.com", receivedAt: c.receivedAt }] });
    const [, used, again, missing, extra] = await t.talk([
      { id: 1, op: "hello", token: t.token }, { id: 2, op: "used", codeId: c.id }, { id: 3, op: "list" }, { id: 4, op: "used", codeId: "nope" }, { id: 5, op: "getThread", threadId: 1 },
    ]);
    expect(used).toEqual({ id: 2, ok: true });
    expect(again).toEqual({ id: 3, ok: true, codes: [] });
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(extra).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(t.used).toEqual([c.id]);
    await t.server.close();
  });

  it("answers disabled when codes are turned off, and removes the socket on close", async () => {
    const t = await start(false);
    const [, r] = await t.talk([{ id: 1, op: "hello", token: t.token }, { id: 2, op: "list" }]);
    expect(r).toMatchObject({ ok: false, error: { code: "disabled" } });
    await t.server.close();
    expect(() => statSync(t.paths.socketPath)).toThrow();
  });
});
