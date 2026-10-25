import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { makeStore, me, msg, person, seedImap, T0, type ImapSeed } from "../store/testkit";
import type { Store } from "../store";
import type { FlintEvent } from "../types";
import { Scheduler } from "./scheduler";
import { SEND_RETRY_BACKOFF_MS, type SchedulerJobs } from "./types";
import { FakeClock } from "./testkit";

type Env = ReturnType<typeof build>;

function build(jobs: SchedulerJobs) {
  const store = makeStore();
  const seed = seedImap(store);
  const clock = new FakeClock(T0);
  const events: FlintEvent[] = [];
  const scheduler = new Scheduler({ store, now: clock.nowFn, setTimer: clock.setTimer, clearTimer: clock.clearTimer, jobs, emit: (e) => events.push(e) });
  return { store, seed, clock, events, scheduler };
}

const draftFor = (store: Store, seed: ImapSeed) =>
  store.createDraft({ accountId: seed.account.id, from: seed.account.email, to: [person("Carla")], subject: "Hi" });

const sendEvents = (events: FlintEvent[]) => events.flatMap((e) => (e.type === "send" ? [e.scheduled.status] : []));

describe("send queue", () => {
  let sendDraft: Mock<NonNullable<SchedulerJobs["sendDraft"]>>;
  let env: Env;
  beforeEach(() => {
    sendDraft = vi.fn<NonNullable<SchedulerJobs["sendDraft"]>>(async () => ({ messageId: "sent1@example.com" }));
    env = build({ sendDraft });
  });

  it("arms one timer for the next pending send and sends when due", async () => {
    const { store, seed, clock, scheduler, events } = env;
    const row = store.createScheduledSend({ draftId: draftFor(store, seed).id, sendAt: T0 + 5000 });
    await scheduler.start();
    expect(clock.armedIn).toBe(5000);
    await clock.advance(4999);
    expect(sendDraft).not.toHaveBeenCalled();
    await clock.advance(1);
    expect(sendDraft).toHaveBeenCalledWith(row.draftId, row.id);
    expect(store.getScheduledSend(row.id)).toMatchObject({ status: "sent", messageId: "sent1@example.com" });
    expect(sendEvents(events)).toEqual(["sending", "sent"]);
    expect(clock.timers.size).toBe(0);
  });

  it("sends immediately on start when already overdue (rebuilds from the DB)", async () => {
    const { store, seed, scheduler } = env;
    const row = store.createScheduledSend({ draftId: draftFor(store, seed).id, sendAt: T0 - 60_000 });
    await scheduler.start();
    expect(store.getScheduledSend(row.id)?.status).toBe("sent");
  });

  it("never sends awaiting_approval and arms nothing for it", async () => {
    const { store, seed, clock, scheduler } = env;
    const row = store.createScheduledSend({ draftId: draftFor(store, seed).id, sendAt: T0 - 1, status: "awaiting_approval" });
    await scheduler.start();
    await clock.advance(10 * 60_000);
    expect(sendDraft).not.toHaveBeenCalled();
    expect(clock.timers.size).toBe(0);
    store.updateScheduled(row.id, { status: "pending" });
    scheduler.poke();
    await clock.advance(0);
    await clock.advance(1);
    expect(sendDraft).toHaveBeenCalledTimes(1);
  });

  it("poke re-arms for an earlier item", async () => {
    const { store, seed, clock, scheduler } = env;
    store.createScheduledSend({ draftId: draftFor(store, seed).id, sendAt: T0 + 60_000 });
    await scheduler.start();
    expect(clock.armedIn).toBe(60_000);
    store.createScheduledSend({ draftId: draftFor(store, seed).id, sendAt: T0 + 1000 });
    scheduler.poke();
    expect(clock.armedIn).toBe(1000);
    expect(clock.timers.size).toBe(1);
  });

  it("retries three times with backoff, then fails with a toast", async () => {
    sendDraft.mockRejectedValue(new Error("smtp down"));
    const { store, seed, clock, scheduler, events } = env;
    const row = store.createScheduledSend({ draftId: draftFor(store, seed).id, sendAt: T0 });
    await scheduler.start();
    expect(store.getScheduledSend(row.id)).toMatchObject({ status: "pending", attempts: 1, error: "smtp down", sendAt: T0 + SEND_RETRY_BACKOFF_MS[0] });
    await clock.advance(SEND_RETRY_BACKOFF_MS[0]);
    expect(store.getScheduledSend(row.id)).toMatchObject({ status: "pending", attempts: 2 });
    await clock.advance(SEND_RETRY_BACKOFF_MS[1]);
    expect(store.getScheduledSend(row.id)).toMatchObject({ status: "pending", attempts: 3 });
    await clock.advance(SEND_RETRY_BACKOFF_MS[2]);
    expect(store.getScheduledSend(row.id)).toMatchObject({ status: "failed", attempts: 4, error: "smtp down" });
    expect(sendDraft).toHaveBeenCalledTimes(4);
    expect(events.filter((e) => e.type === "toast")).toEqual([expect.objectContaining({ level: "error", message: expect.stringContaining("Hi") })]);
    expect(clock.timers.size).toBe(0);
  });

  it("succeeds on a retry", async () => {
    sendDraft.mockRejectedValueOnce(new Error("blip"));
    const { store, seed, clock, scheduler } = env;
    const row = store.createScheduledSend({ draftId: draftFor(store, seed).id, sendAt: T0 });
    await scheduler.start();
    await clock.advance(SEND_RETRY_BACKOFF_MS[0]);
    expect(store.getScheduledSend(row.id)).toMatchObject({ status: "sent", error: null });
  });

  it("marks sends interrupted mid-flight as failed instead of resending", async () => {
    const { store, seed, scheduler } = env;
    const row = store.createScheduledSend({ draftId: draftFor(store, seed).id, sendAt: T0 - 1, status: "sending" });
    await scheduler.start();
    expect(sendDraft).not.toHaveBeenCalled();
    expect(store.getScheduledSend(row.id)?.status).toBe("failed");
  });

  it("describes non-Error failures", async () => {
    sendDraft.mockRejectedValue("boom");
    const { store, seed, scheduler } = env;
    const row = store.createScheduledSend({ draftId: draftFor(store, seed).id, sendAt: T0 });
    await scheduler.start();
    expect(store.getScheduledSend(row.id)?.error).toBe("boom");
  });
});

describe("snooze and reminders", () => {
  it("wakes a snoozed thread: clears snooze, resurfaces, marks latest unread, notifies", async () => {
    const onSnoozeWake = vi.fn();
    const { store, seed, clock, scheduler, events } = build({ onSnoozeWake });
    const [o] = store.ingestMessages(seed.account.id, seed.inbox.id, [msg({ uid: 1, flags: { seen: true, flagged: false, answered: false, draft: false }, subject: "Lunch" })]);
    store.snooze([o!.threadId], T0 + 3600_000);
    await scheduler.start();
    expect(clock.armedIn).toBe(3600_000);
    await clock.advance(3600_000);
    const rows = store.getThreadRows(o!.threadId)!;
    expect(rows.snoozedUntil).toBeNull();
    expect(rows.resurfacedAt).toBe(T0 + 3600_000);
    expect(rows.messages[0]!.seen).toBe(false);
    expect(onSnoozeWake).toHaveBeenCalledWith(expect.objectContaining({ threadId: o!.threadId, subject: "Lunch", locations: [expect.objectContaining({ uid: 1 })] }));
    expect(events).toContainEqual({ type: "mail_changed", accountId: seed.account.id, threadIds: [o!.threadId] });
  });

  it("survives a throwing snooze callback", async () => {
    const { store, seed, scheduler } = build({ onSnoozeWake: () => { throw new Error("x"); } });
    const [o] = store.ingestMessages(seed.account.id, seed.inbox.id, [msg({ uid: 1 })]);
    store.snooze([o!.threadId], T0 - 1);
    await scheduler.start();
    expect(store.getThreadRows(o!.threadId)?.snoozedUntil).toBeNull();
  });

  const sentThread = (env: ReturnType<typeof build>) => {
    const { store, seed } = env;
    const [o] = store.ingestMessages(seed.account.id, seed.sent.id, [msg({ uid: 1, messageId: "out@example.com", from: [me()], to: [person("Carla Diaz")], date: T0 - 1000, flags: { seen: true, flagged: false, answered: false, draft: false } })]);
    return o!.threadId;
  };

  it("fires a reminder when nobody replied", async () => {
    const onReminder = vi.fn();
    const env = build({ onReminder });
    const threadId = sentThread(env);
    const r = env.store.createReminder({ accountId: env.seed.account.id, threadId, messageId: "<out@example.com>", remindAt: T0 + 1000 });
    await env.scheduler.start();
    await env.clock.advance(1000);
    expect(env.store.getReminder(r.id)?.status).toBe("fired");
    expect(env.store.getThreadRows(threadId)?.resurfacedAt).toBe(T0 + 1000);
    expect(onReminder).toHaveBeenCalledWith(expect.objectContaining({ outcome: "fired", message: "No reply from Carla yet", threadId }));
  });

  it("marks replied when someone else wrote after the sent message", async () => {
    const onReminder = vi.fn();
    const env = build({ onReminder });
    const threadId = sentThread(env);
    env.store.ingestMessages(env.seed.account.id, env.seed.inbox.id, [msg({ uid: 5, inReplyTo: "out@example.com", references: ["out@example.com"], subject: "Re: Hello", date: T0 - 500 })]);
    const r = env.store.createReminder({ accountId: env.seed.account.id, threadId, messageId: "out@example.com", remindAt: T0 + 10 });
    await env.scheduler.start();
    await env.clock.advance(10);
    expect(env.store.getReminder(r.id)?.status).toBe("replied");
    expect(env.store.getThreadRows(threadId)?.resurfacedAt).toBeNull();
    expect(onReminder).toHaveBeenCalledWith(expect.objectContaining({ outcome: "replied" }));
  });

  it("cancels a reminder whose thread cannot be found", async () => {
    const env = build({});
    const r = env.store.createReminder({ accountId: env.seed.account.id, threadId: null, messageId: "gone@example.com", remindAt: T0 });
    await env.scheduler.start();
    expect(env.store.getReminder(r.id)?.status).toBe("cancelled");
  });
});

describe("receipts cadence", () => {
  const track = (env: Env, sentAt: number, ref = "r1", messageId = "o1@example.com") =>
    env.store.createTracked({ accountId: env.seed.account.id, ref, messageId, threadId: null, subject: "S", sentAt, recipients: [{ email: "c@example.org", token: ref.padEnd(22, "x") }] });

  it("does nothing without tracked messages", async () => {
    const receipts = { pollEvents: vi.fn(async () => 0), seenPing: vi.fn(async () => true) };
    const env = build({ receipts });
    await env.scheduler.start();
    expect(env.clock.timers.size).toBe(0);
    expect(receipts.pollEvents).not.toHaveBeenCalled();
  });

  it("polls every 10s for 10 minutes after a send, then every 60s, then stops after 30 days", async () => {
    const receipts = { pollEvents: vi.fn(async () => 0), seenPing: vi.fn(async () => true) };
    const e2 = build({ receipts });
    track(e2, T0);
    await e2.scheduler.start();
    await e2.clock.advance(0);
    expect(receipts.pollEvents).toHaveBeenCalledTimes(1);
    expect(receipts.seenPing).toHaveBeenCalledTimes(1);
    await e2.clock.advance(60_000);
    expect(receipts.pollEvents).toHaveBeenCalledTimes(7);
    await e2.clock.advance(9 * 60_000 + 1);
    const atTenMin = receipts.pollEvents.mock.calls.length;
    expect(atTenMin).toBeGreaterThanOrEqual(60);
    await e2.clock.advance(60_000);
    expect(receipts.pollEvents.mock.calls.length - atTenMin).toBe(1);
    expect(receipts.seenPing).toHaveBeenCalledTimes(2);
    await e2.clock.advance(30 * 24 * 3600_000);
    const done = receipts.pollEvents.mock.calls.length;
    await e2.clock.advance(3600_000);
    expect(receipts.pollEvents.mock.calls.length).toBe(done);
    expect(e2.clock.timers.size).toBe(0);
    // Steps a fake clock through 30 days of 60 s polls: about 1 s alone, several under the parallel release run.
  }, 20_000);

  it("start() returns without waiting for a hung receipts poll; the timer runs it right after", async () => {
    const receipts = { pollEvents: vi.fn(() => new Promise<number>(() => undefined)), seenPing: vi.fn(async () => true) };
    const env = build({ receipts });
    track(env, T0);
    await env.scheduler.start();
    expect(receipts.pollEvents).not.toHaveBeenCalled();
    expect(env.clock.armedIn).toBe(0);
    await env.clock.advance(0);
    expect(receipts.pollEvents).toHaveBeenCalledTimes(1);
  });

  it("keeps going when polling and pinging throw", async () => {
    const receipts = { pollEvents: vi.fn(async () => { throw new Error("net"); }), seenPing: vi.fn(async () => { throw new Error("net"); }) };
    const env = build({ receipts });
    track(env, T0);
    await env.scheduler.start();
    await env.clock.advance(10_000);
    expect(receipts.pollEvents).toHaveBeenCalledTimes(2);
  });

  it("uses the slow cadence for an older tracked message and starts polling after a poke", async () => {
    const receipts = { pollEvents: vi.fn(async () => 0), seenPing: vi.fn(async () => true) };
    const env = build({ receipts });
    await env.scheduler.start();
    track(env, T0 - 3600_000);
    env.scheduler.poke();
    expect(env.clock.armedIn).toBe(0);
    await env.clock.advance(0);
    expect(receipts.pollEvents).toHaveBeenCalledTimes(1);
    expect(env.clock.armedIn).toBe(60_000);
  });
});

describe("lifecycle", () => {
  it("combines items into the earliest timer and caps long delays", async () => {
    const env = build({ sendDraft: async () => undefined });
    env.store.createScheduledSend({ draftId: draftFor(env.store, env.seed).id, sendAt: T0 + 10 * 24 * 3600_000 });
    await env.scheduler.start();
    expect(env.clock.armedIn).toBe(3600_000);
    expect(env.scheduler.nextDueAt()).toBe(T0 + 10 * 24 * 3600_000);
  });

  it("stop clears the timer and poke is ignored before start", async () => {
    const env = build({ sendDraft: async () => undefined });
    env.store.createScheduledSend({ draftId: draftFor(env.store, env.seed).id, sendAt: T0 + 1000 });
    env.scheduler.poke();
    expect(env.clock.timers.size).toBe(0);
    await env.scheduler.start();
    await env.scheduler.start();
    expect(env.clock.timers.size).toBe(1);
    env.scheduler.stop();
    expect(env.clock.timers.size).toBe(0);
  });

  it("poke during a running tick does not arm twice", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const env = build({ sendDraft: () => gate.then(() => undefined) });
    env.store.createScheduledSend({ draftId: draftFor(env.store, env.seed).id, sendAt: T0 });
    const started = env.scheduler.start();
    await env.clock.settle();
    env.scheduler.poke();
    expect(env.clock.timers.size).toBe(0);
    release();
    await started;
    expect(env.clock.timers.size).toBe(0);
  });

  it("overlapping ticks share one run", async () => {
    const sendDraft = vi.fn(async () => undefined);
    const env = build({ sendDraft });
    env.store.createScheduledSend({ draftId: draftFor(env.store, env.seed).id, sendAt: T0 });
    await Promise.all([env.scheduler.start(), env.scheduler.tick()]);
    expect(sendDraft).toHaveBeenCalledTimes(1);
  });

  it("works with no jobs and no emit", async () => {
    const store = makeStore();
    const clock = new FakeClock(T0);
    const s = new Scheduler({ store, now: clock.nowFn, setTimer: clock.setTimer, clearTimer: clock.clearTimer, jobs: {} });
    await s.start();
    expect(s.nextDueAt()).toBeNull();
  });
});
