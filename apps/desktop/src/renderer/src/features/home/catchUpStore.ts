import { createStore, useStore, type StoreApi } from "zustand";
import { z } from "zod";
import { FlintError } from "@flint/core/types";
import type { FlintApi, ThreadListItem } from "@flint/core";
import { flint } from "../../lib/api";
import { readStored, writeStored } from "../../lib/storage";
import { idleRun, isBusy, runReducer, type Citation, type RunAction, type RunState } from "../ai/aiRun";

/**
 * "Catch me up" outside React: one digest run at a time that keeps streaming when Home unmounts,
 * the last good result kept in localStorage, and an automatic run every 3 hours while +AI is on.
 * Manual and automatic runs share the same result.
 */

export const STORED_KEY = "flint.catchUp.v1";
export const AUTO_KEY = "flint.catchUp.auto";
export const EVERY_MS = 3 * 60 * 60 * 1000;
export const RETRY_MS = 15 * 60 * 1000;
/** The timer never waits longer than this, so sleep and clock changes can't push a run far past its slot. */
export const MAX_WAIT_MS = 60 * 60 * 1000;
/** How many unread people threads a digest reads (core's DIGEST_THREADS). */
const DIGEST_THREADS = 12;

export type CatchUpResult = {
  text: string;
  citations: Citation[];
  at: number;
  /** The unread people threads (`id.unreadCount`) on hand when this digest started. */
  covered?: string[];
};
export type CatchUpStatus = "idle" | "running" | "ready" | "error" | "not_connected";

export type CatchUpState = {
  status: CatchUpStatus;
  /** The last good digest. Stays on screen while a new run streams into `run`. */
  result: CatchUpResult | null;
  /** When an automatic check last found no new mail and skipped the run. */
  checkedAt: number;
  run: RunState;
  error: string | null;
  auto: boolean;
  /** Automatic runs that failed in a row, and when the last one did. */
  failures: number;
  failedAt: number;
};

const storedSchema = z.object({
  text: z.string().min(1),
  citations: z.array(z.object({ threadId: z.number(), subject: z.string() })),
  at: z.number(),
  covered: z.array(z.string()).optional(),
  checkedAt: z.number().optional(),
});

/** The persisted result, or null when it is missing or malformed. */
export function parseStored(raw: string | null): { result: CatchUpResult; checkedAt: number } | null {
  if (!raw) return null;
  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const { text, citations, at, covered, checkedAt = 0 } = parsed.data;
    return { result: { text, citations, at, ...(covered ? { covered } : {}) }, checkedAt };
  } catch {
    return null;
  }
}

/** When the next automatic run is due: 15 minutes after a first failure, otherwise 3 hours after the last result, skip or failure. */
export function dueAt(s: Pick<CatchUpState, "result" | "checkedAt" | "failures" | "failedAt">): number {
  if (s.failures === 1) return s.failedAt + RETRY_MS;
  return Math.max(s.result?.at ?? 0, s.checkedAt, s.failures > 1 ? s.failedAt : 0) + EVERY_MS;
}

export function waitMs(due: number, now: number): number {
  return Math.max(0, Math.min(due - now, MAX_WAIT_MS));
}

const threadKey = (t: ThreadListItem): string => `${t.id}.${t.unreadCount}`;

const messageOf = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : "The AI request failed.";

export type CatchUp = {
  store: StoreApi<CatchUpState>;
  /** Starts a run now unless one is already going. */
  refresh: (auto?: boolean) => Promise<void>;
  /** Runs if an automatic run is due and allowed, then re-arms the timer. */
  tick: () => Promise<void>;
  setAuto: (on: boolean) => void;
  /** Subscribes to events, focus and wake, and arms the timer. Returns a stop function. */
  start: () => () => void;
};

export function createCatchUp({ api, now = Date.now }: { api: FlintApi; now?: () => number }): CatchUp {
  const saved = parseStored(readStored(STORED_KEY));
  const store = createStore<CatchUpState>(() => ({
    status: saved ? "ready" : "idle",
    result: saved?.result ?? null,
    checkedAt: saved?.checkedAt ?? 0,
    run: idleRun,
    error: null,
    auto: readStored(AUTO_KEY) !== "0",
    failures: 0,
    failedAt: 0,
  }));
  let started = false;
  let checking = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  let current: { startedAt: number; auto: boolean; covered?: string[] } = { startedAt: 0, auto: false };

  const persist = () => {
    const { result, checkedAt } = store.getState();
    if (result) writeStored(STORED_KEY, JSON.stringify({ ...result, checkedAt }));
  };

  const arm = (ms?: number) => {
    clearTimeout(timer);
    const s = store.getState();
    if (!started || !s.auto) return;
    timer = setTimeout(() => void tick(), ms ?? waitMs(dueAt(s), now()));
  };

  const settle = (run: RunState) => {
    const s = store.getState();
    if (run.status === "done" && run.text.trim()) {
      const { startedAt: at, covered } = current;
      store.setState({ status: "ready", result: { text: run.text, citations: run.citations, at, ...(covered ? { covered } : {}) }, error: null, failures: 0, failedAt: 0 });
      persist();
    } else if (run.notConnected) {
      store.setState({ status: "not_connected", error: run.error });
    } else {
      const failed = current.auto ? { failures: s.failures + 1, failedAt: now() } : {};
      store.setState({ status: "error", error: run.error || "The AI request failed.", ...failed });
    }
    arm();
  };

  const dispatch = (action: RunAction) => {
    const prev = store.getState().run;
    const run = runReducer(prev, action);
    if (run === prev) return;
    store.setState({ run });
    if (isBusy(prev) && !isBusy(run) && (run.status === "done" || run.status === "error")) settle(run);
  };

  async function unreadPeople(): Promise<ThreadListItem[]> {
    return (await api.listThreads({ view: "inbox", focused: true, unreadOnly: true, limit: DIGEST_THREADS })).items;
  }

  async function refresh(auto = false): Promise<void> {
    if (isBusy(store.getState().run)) return;
    const mine = ++seq;
    current = { startedAt: now(), auto };
    // What the digest is about to read, so a later check can tell new mail by thread, not by its Date header.
    unreadPeople().then(
      (items) => { if (mine === seq) current = { ...current, covered: items.map(threadKey) }; },
      () => {},
    );
    clearTimeout(timer);
    store.setState({ status: "running", error: null });
    dispatch({ type: "start" });
    try {
      const { runId } = await api.aiRun({ kind: "digest" });
      if (mine === seq) dispatch({ type: "started", runId });
    } catch (err) {
      if (mine === seq) dispatch({ type: "failed", message: messageOf(err), notConnected: err instanceof FlintError && err.code === "ai_not_connected" });
    }
  }

  /** Whether there is unread people mail the digest didn't cover. Errs toward running. */
  async function arrivedSince(result: CatchUpResult): Promise<boolean> {
    try {
      const items = await unreadPeople();
      if (!result.covered) return (items[0]?.lastDate ?? 0) > result.at;
      // New when a thread wasn't covered or has more unread than it did; reading part of one isn't new mail.
      const covered = new Map(result.covered.map((k) => [k.split(".")[0], Number(k.split(".")[1])]));
      return items.some((t) => t.unreadCount > (covered.get(String(t.id)) ?? 0));
    } catch {
      return true;
    }
  }

  async function tick(): Promise<void> {
    const s = store.getState();
    if (checking || isBusy(s.run) || !s.auto) return;
    if (now() < dueAt(s)) return arm();
    checking = true;
    try {
      const ai = await api.aiStatus().catch(() => null);
      if (!ai?.connected || !ai.enabled) return arm(MAX_WAIT_MS);
      const { result } = store.getState();
      if (result && !(await arrivedSince(result))) {
        // Nothing to retry either, so a failed run's 15-minute slot can't keep the check due.
        store.setState({ checkedAt: now(), failures: 0, failedAt: 0 });
        persist();
        return arm();
      }
    } finally {
      checking = false;
    }
    // Auto may have been switched off while the checks above were waiting.
    if (!started || !store.getState().auto) return;
    await refresh(true);
  }

  function setAuto(on: boolean): void {
    writeStored(AUTO_KEY, on ? "1" : "0");
    store.setState({ auto: on });
    if (on) void tick();
    else clearTimeout(timer);
  }

  function start(): () => void {
    started = true;
    const off = api.subscribe((e) => {
      if (e.type === "ai") dispatch({ type: "chunk", chunk: e.chunk });
      else if (e.type === "settings") void tick();
    });
    const wake = () => {
      if (document.visibilityState === "visible") void tick();
    };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    void tick();
    return () => {
      started = false;
      clearTimeout(timer);
      off();
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }

  return { store, refresh, tick, setAuto, start };
}

export const catchUp = createCatchUp({ api: flint });
// HomeView is imported by AppShell, so this runs at app start. Tests drive their own instance.
if (typeof window !== "undefined" && import.meta.env.MODE !== "test") catchUp.start();

export function useCatchUp<T>(selector: (s: CatchUpState) => T): T {
  return useStore(catchUp.store, selector);
}
