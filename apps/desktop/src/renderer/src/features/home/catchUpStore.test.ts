import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlintError } from "@flint/core/types";
import type { AiChunk, FlintApi, FlintEvent, ThreadPage } from "@flint/core";
import { AUTO_KEY, createCatchUp, dueAt, EVERY_MS, MAX_WAIT_MS, parseStored, RETRY_MS, STORED_KEY, waitMs } from "./catchUpStore";

/** An AiChunk without its runId (Omit on the union would collapse it). */
type ChunkBody = AiChunk extends infer C ? (C extends AiChunk ? Omit<C, "runId"> : never) : never;

const T0 = new Date(2026, 9, 25, 14, 0).getTime();
const HOUR = 60 * 60 * 1000;

type Unread = Pick<ThreadPage["items"][number], "id" | "unreadCount" | "lastDate">;

function fakeApi(opts: { connected?: boolean; enabled?: boolean; newestUnread?: number; unread?: Unread[]; fail?: boolean } = {}) {
  let listener: ((e: FlintEvent) => void) | null = null;
  let n = 0;
  const api = {
    aiStatus: vi.fn(async () => ({ connected: opts.connected ?? true, enabled: opts.enabled ?? true, provider: "codex", model: null, models: [] })),
    aiRun: vi.fn(async () => {
      if (opts.fail) throw new FlintError("network", "The AI provider didn't answer.");
      return { runId: `r${++n}` };
    }),
    listThreads: vi.fn(async (): Promise<ThreadPage> => ({
      items: (opts.unread ?? (opts.newestUnread === undefined ? [] : [{ id: 1, unreadCount: 1, lastDate: opts.newestUnread }])) as ThreadPage["items"],
      bundles: [], nextCursor: null,
    })),
    subscribe: (l: (e: FlintEvent) => void) => { listener = l; return () => { listener = null; }; },
  };
  const emit = (chunk: ChunkBody, runId = `r${n}`) => listener?.({ type: "ai", chunk: { ...chunk, runId } as AiChunk });
  const finish = (text = "- Maria asks about lunch. [1]") => {
    emit({ type: "text", text });
    emit({ type: "citations", threads: [{ threadId: 7, subject: "Lunch" }] });
    emit({ type: "done", text });
  };
  return { api: api as unknown as FlintApi, raw: api, emit, finish, setOpts: (o: typeof opts) => Object.assign(opts, o) };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  window.localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("dueAt and waitMs", () => {
  const base = { result: null, checkedAt: 0, failures: 0, failedAt: 0 };
  it("is due 3 hours after the last result or skip", () => {
    expect(dueAt(base)).toBe(EVERY_MS);
    expect(dueAt({ ...base, result: { text: "x", citations: [], at: T0 } })).toBe(T0 + EVERY_MS);
    expect(dueAt({ ...base, result: { text: "x", citations: [], at: T0 }, checkedAt: T0 + HOUR })).toBe(T0 + HOUR + EVERY_MS);
  });
  it("retries once after 15 minutes, then waits for the next slot", () => {
    expect(dueAt({ ...base, failures: 1, failedAt: T0 })).toBe(T0 + RETRY_MS);
    expect(dueAt({ ...base, failures: 2, failedAt: T0 })).toBe(T0 + EVERY_MS);
  });
  it("never waits more than an hour", () => {
    expect(waitMs(T0 + EVERY_MS, T0)).toBe(MAX_WAIT_MS);
    expect(waitMs(T0 + 1000, T0)).toBe(1000);
    expect(waitMs(T0 - 1000, T0)).toBe(0);
  });
});

describe("parseStored", () => {
  it("reads a saved result and rejects junk", () => {
    expect(parseStored(JSON.stringify({ text: "hi", citations: [{ threadId: 1, subject: "s" }], at: 5 }))).toEqual({ result: { text: "hi", citations: [{ threadId: 1, subject: "s" }], at: 5 }, checkedAt: 0 });
    expect(parseStored("{bad")).toBeNull();
    expect(parseStored(JSON.stringify({ text: "", citations: [], at: 1 }))).toBeNull();
    expect(parseStored(null)).toBeNull();
  });
});

describe("createCatchUp", () => {
  it("runs at start when nothing is saved, collects chunks and citations, and persists the result", async () => {
    const f = fakeApi();
    const c = createCatchUp({ api: f.api });
    const stop = c.start();
    await flush();
    expect(f.raw.aiRun).toHaveBeenCalledWith({ kind: "digest" });
    expect(c.store.getState().status).toBe("running");
    f.finish();
    const s = c.store.getState();
    expect(s.status).toBe("ready");
    expect(s.result).toEqual({ text: "- Maria asks about lunch. [1]", citations: [{ threadId: 7, subject: "Lunch" }], at: T0, covered: [] });
    expect(parseStored(window.localStorage.getItem(STORED_KEY))?.result.at).toBe(T0);
    stop();
  });

  it("loads the saved result and waits until it is 3 hours old", async () => {
    window.localStorage.setItem(STORED_KEY, JSON.stringify({ text: "- old [1]", citations: [], at: T0 - HOUR }));
    const f = fakeApi({ newestUnread: T0 });
    const c = createCatchUp({ api: f.api });
    expect(c.store.getState()).toMatchObject({ status: "ready", result: { text: "- old [1]" } });
    const stop = c.start();
    await flush();
    expect(f.raw.aiRun).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(f.raw.aiRun).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(f.raw.aiRun).toHaveBeenCalledTimes(1);
    stop();
  });

  it("skips a due run when no new mail arrived, and pushes the next slot out", async () => {
    window.localStorage.setItem(STORED_KEY, JSON.stringify({ text: "- old [1]", citations: [], at: T0 - EVERY_MS }));
    const f = fakeApi({ newestUnread: T0 - EVERY_MS - HOUR });
    const c = createCatchUp({ api: f.api });
    const stop = c.start();
    await flush();
    expect(f.raw.listThreads).toHaveBeenCalled();
    expect(f.raw.aiRun).not.toHaveBeenCalled();
    expect(c.store.getState().checkedAt).toBe(T0);
    expect(parseStored(window.localStorage.getItem(STORED_KEY))?.checkedAt).toBe(T0);
    stop();
  });

  it("runs when an unread thread the digest didn't cover shows up, even with an older Date header", async () => {
    const f = fakeApi({ unread: [{ id: 1, unreadCount: 2, lastDate: T0 - 5 * HOUR }] });
    const c = createCatchUp({ api: f.api });
    const stop = c.start();
    await flush();
    f.finish();
    expect(c.store.getState().result?.covered).toEqual(["1.2"]);
    expect(parseStored(window.localStorage.getItem(STORED_KEY))?.result.covered).toEqual(["1.2"]);
    // Reading part of a covered thread is not new mail.
    f.setOpts({ unread: [{ id: 1, unreadCount: 1, lastDate: T0 - 5 * HOUR }] });
    await vi.advanceTimersByTimeAsync(EVERY_MS);
    expect(f.raw.aiRun).toHaveBeenCalledTimes(1);
    expect(c.store.getState().checkedAt).toBe(T0 + EVERY_MS);
    // Synced late: stamped before the digest started, but the digest never saw it.
    f.setOpts({ unread: [{ id: 1, unreadCount: 1, lastDate: T0 - 5 * HOUR }, { id: 2, unreadCount: 1, lastDate: T0 - HOUR }] });
    await vi.advanceTimersByTimeAsync(EVERY_MS);
    expect(f.raw.aiRun).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does not start a run when auto is switched off while a check is in flight", async () => {
    window.localStorage.setItem(STORED_KEY, JSON.stringify({ text: "- old [1]", citations: [], at: T0 - EVERY_MS }));
    const f = fakeApi({ newestUnread: T0 });
    const status = { connected: true, enabled: true, provider: "codex", model: null, models: [] };
    let answer: (v: typeof status) => void = () => {};
    f.raw.aiStatus.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const c = createCatchUp({ api: f.api });
    const stop = c.start();
    await flush();
    c.setAuto(false);
    answer(status);
    await flush();
    expect(f.raw.aiRun).not.toHaveBeenCalled();
    stop();
  });

  it("does nothing when +AI is off or auto is switched off", async () => {
    const off = fakeApi({ enabled: false });
    const a = createCatchUp({ api: off.api });
    const stopA = a.start();
    await flush();
    expect(off.raw.aiRun).not.toHaveBeenCalled();
    stopA();

    window.localStorage.setItem(AUTO_KEY, "0");
    const f = fakeApi();
    const b = createCatchUp({ api: f.api });
    expect(b.store.getState().auto).toBe(false);
    const stopB = b.start();
    await vi.advanceTimersByTimeAsync(5 * HOUR);
    expect(f.raw.aiRun).not.toHaveBeenCalled();
    b.setAuto(true);
    await flush();
    expect(f.raw.aiRun).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(AUTO_KEY)).toBe("1");
    stopB();
  });

  it("retries a failed automatic run once after 15 minutes, then waits 3 hours", async () => {
    const f = fakeApi({ fail: true });
    const c = createCatchUp({ api: f.api });
    const stop = c.start();
    await flush();
    expect(c.store.getState()).toMatchObject({ status: "error", failures: 1, error: "The AI provider didn't answer." });
    await vi.advanceTimersByTimeAsync(RETRY_MS - 1000);
    expect(f.raw.aiRun).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.raw.aiRun).toHaveBeenCalledTimes(2);
    expect(c.store.getState().failures).toBe(2);
    await vi.advanceTimersByTimeAsync(EVERY_MS - 1000);
    expect(f.raw.aiRun).toHaveBeenCalledTimes(2);
    f.setOpts({ fail: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.raw.aiRun).toHaveBeenCalledTimes(3);
    f.finish();
    expect(c.store.getState()).toMatchObject({ status: "ready", failures: 0 });
    stop();
  });

  it("does not spin when the retry after a failed run finds no new mail", async () => {
    window.localStorage.setItem(STORED_KEY, JSON.stringify({ text: "- old [1]", citations: [], at: T0 - EVERY_MS }));
    const f = fakeApi({ newestUnread: T0, fail: true });
    const c = createCatchUp({ api: f.api });
    const stop = c.start();
    await flush();
    expect(c.store.getState()).toMatchObject({ status: "error", failures: 1 });
    // The user reads the new mail before the retry slot.
    f.setOpts({ newestUnread: T0 - EVERY_MS - HOUR, fail: false });
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    const checks = f.raw.aiStatus.mock.calls.length;
    expect(c.store.getState()).toMatchObject({ checkedAt: T0 + RETRY_MS, failures: 0, failedAt: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.raw.aiStatus).toHaveBeenCalledTimes(checks);
    expect(f.raw.listThreads.mock.calls.length).toBeLessThan(10);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(EVERY_MS - 60_000);
    expect(f.raw.aiStatus).toHaveBeenCalledTimes(checks + 1);
    expect(f.raw.aiRun).toHaveBeenCalledTimes(1);
    stop();
  });

  it("marks a not-connected failure without counting it as a retryable error", async () => {
    const f = fakeApi();
    f.raw.aiRun.mockRejectedValueOnce(new FlintError("ai_not_connected", "Connect ChatGPT or Grok in Settings → +AI"));
    const c = createCatchUp({ api: f.api });
    await c.refresh();
    expect(c.store.getState()).toMatchObject({ status: "not_connected", failures: 0 });
  });

  it("keeps the previous result while a manual refresh streams, and ignores a second refresh", async () => {
    window.localStorage.setItem(STORED_KEY, JSON.stringify({ text: "- old [1]", citations: [], at: T0 - HOUR }));
    const f = fakeApi();
    const c = createCatchUp({ api: f.api });
    const stop = c.start();
    await c.refresh();
    await c.refresh();
    expect(f.raw.aiRun).toHaveBeenCalledTimes(1);
    f.emit({ type: "text", text: "- new" });
    expect(c.store.getState()).toMatchObject({ status: "running", result: { text: "- old [1]" }, run: { text: "- new" } });
    f.finish("- new [1]");
    expect(c.store.getState().result?.text).toBe("- new [1]");
    stop();
  });
});
