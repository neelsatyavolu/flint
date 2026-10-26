import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../store/settings";
import type { NotifyRequest } from "../platform";
import type { Settings } from "../types";
import { createCodeRegistry } from "../codes/registry";
import { EventBus } from "./events";
import { notifyApi, wireNotifications } from "./notify";
import { alertFor, soundFor, wantsAlert, type NewMailEvent } from "./notifyPolicy";
import type { ServiceContext } from "./context";

const mail = (over: Partial<NewMailEvent> = {}): NewMailEvent => ({
  type: "new_mail", accountId: "a1", threadId: 1, from: { name: "Ann Lee", address: "ann@example.org" },
  subject: "Lunch?", category: "people", snippet: "Are you free at noon?", ...over,
});
const notif = (over: Partial<Settings["notifications"]> = {}): Settings["notifications"] => ({ ...DEFAULT_SETTINGS.notifications, ...over });

function setup(over: Partial<Settings["notifications"]> = {}) {
  const sent: NotifyRequest[] = [];
  const bus = new EventBus();
  let settings: Settings = { ...DEFAULT_SETTINGS, notifications: notif(over) };
  const ctx = {
    bus, platform: { notify: (n: NotifyRequest) => sent.push(n) }, getSettings: () => settings, codes: createCodeRegistry(), now: Date.now,
  } as unknown as ServiceContext;
  return { sent, bus, ctx, set: (o: Partial<Settings["notifications"]>) => { settings = { ...settings, notifications: notif(o) }; } };
}

describe("wantsAlert", () => {
  it("honors enabled, scope and per-account switches", () => {
    expect(wantsAlert(notif(), mail())).toBe(true);
    expect(wantsAlert(notif({ enabled: false }), mail())).toBe(false);
    expect(wantsAlert(notif({ scope: "none" }), mail())).toBe(false);
    expect(wantsAlert(notif({ disabledAccounts: ["a1"] }), mail())).toBe(false);
    expect(wantsAlert(notif({ disabledAccounts: ["other"] }), mail())).toBe(true);
  });
  it("people scope skips other categories unless a rule forced the alert; all scope takes everything", () => {
    expect(wantsAlert(notif({ scope: "people" }), mail({ category: "newsletters" }))).toBe(false);
    expect(wantsAlert(notif({ scope: "people" }), mail({ category: "newsletters", forced: true }))).toBe(true);
    expect(wantsAlert(notif({ scope: "all" }), mail({ category: "notifications" }))).toBe(true);
  });
});

describe("soundFor", () => {
  it("is silent when off, default when unnamed, otherwise the named sound", () => {
    expect(soundFor({ sound: false, soundName: "Glass" })).toBeNull();
    expect(soundFor({ sound: true, soundName: "default" })).toBeUndefined();
    expect(soundFor({ sound: true, soundName: "Glass" })).toBe("Glass");
  });
});

describe("alertFor", () => {
  it("shows sender and subject by default, with Archive and Mark as read for one thread", () => {
    expect(alertFor(notif(), [mail()])).toEqual({ title: "Ann Lee", body: "Lunch?", threadId: 1, group: "thread-1", actions: true, sound: undefined });
  });
  it("adds the first line, or hides everything, by preview setting", () => {
    expect(alertFor(notif({ preview: "sender_subject_line" }), [mail()])!.body).toBe("Lunch?\nAre you free at noon?");
    expect(alertFor(notif({ preview: "none" }), [mail()])).toMatchObject({ title: "New mail", body: "" });
  });
  it("falls back to the address and a placeholder subject", () => {
    expect(alertFor(notif(), [mail({ from: { name: "", address: "x@y.co" }, subject: " " })])).toMatchObject({ title: "x@y.co", body: "(No subject)" });
  });
  it("collapses several threads into one summary without actions", () => {
    const burst = [mail({ threadId: 1 }), mail({ threadId: 2, from: { name: "Bo", address: "bo@x.co" } }), mail({ threadId: 3, from: { name: "Cy", address: "cy@x.co" } }), mail({ threadId: 4, from: { name: "Di", address: "di@x.co" } })];
    const a = alertFor(notif(), burst)!;
    expect(a).toMatchObject({ title: "4 new messages", body: "From Ann Lee, Bo and 2 others", group: "new-mail-summary" });
    expect(a.threadId).toBeUndefined();
    expect(a.actions).toBeUndefined();
    expect(alertFor(notif({ preview: "none" }), burst)!.body).toBe("");
  });
  it("treats a burst in one thread as that thread, and drops unwanted mail", () => {
    expect(alertFor(notif(), [mail({ subject: "A" }), mail({ subject: "B" })])).toMatchObject({ body: "B", threadId: 1 });
    expect(alertFor(notif(), [mail({ category: "newsletters" })])).toBeNull();
  });
});

describe("wireNotifications", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("alerts once after the window and ignores unwanted mail", () => {
    const { sent, bus, ctx } = setup();
    const off = wireNotifications(ctx, { windowMs: 1000 });
    bus.emit(mail({ category: "newsletters", threadId: 9 }));
    bus.emit(mail());
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([expect.objectContaining({ title: "Ann Lee", threadId: 1 })]);
    off();
  });

  it("sends a burst as a single summary", () => {
    const { sent, bus, ctx } = setup({ scope: "all" });
    wireNotifications(ctx, { windowMs: 1000 });
    bus.emit(mail({ threadId: 1 }));
    bus.emit(mail({ threadId: 2 }));
    bus.emit(mail({ threadId: 3 }));
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: "3 new messages", group: "new-mail-summary" });
  });

  it("does nothing for other events, when off, or after unsubscribe", () => {
    const { sent, bus, ctx, set } = setup({ enabled: false });
    const off = wireNotifications(ctx, { windowMs: 10 });
    bus.emit({ type: "mail_changed", accountId: "a1", threadIds: [1] });
    bus.emit(mail());
    vi.advanceTimersByTime(50);
    expect(sent).toHaveLength(0);
    set({});
    bus.emit(mail());
    off();
    vi.advanceTimersByTime(50);
    expect(sent).toHaveLength(0);
  });
});

describe("sendTestNotification", () => {
  it("notifies with the chosen sound even when new mail alerts are off", async () => {
    const { sent, ctx } = setup({ enabled: false, soundName: "Glass" });
    await notifyApi(ctx).sendTestNotification();
    expect(sent).toEqual([expect.objectContaining({ title: "Flint test notification", sound: "Glass" })]);
  });
  it("is silent when sound is off", async () => {
    const { sent, ctx } = setup({ sound: false });
    await notifyApi(ctx).sendTestNotification();
    expect(sent[0]!.sound).toBeNull();
  });
});
