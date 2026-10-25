import type { Store } from "../store";
import type { ScheduledSendRow } from "../store/drafts";
import type { MessageLocation, Reminder } from "../store/types";
import type { FlintEvent, ThreadId } from "../types";

export type TimerHandle = unknown;

/** Ports the host provides. Every one is optional so tests and the CLI can run a subset. */
export type SchedulerJobs = {
  /** Sends the draft over SMTP. Throw to trigger a retry. The scheduler sets the final status. */
  sendDraft?: (draftId: number, scheduledId: number) => Promise<{ messageId?: string } | void>;
  /** A snoozed thread came back. `locations` is the latest message now marked unread (clear \Seen on the server). */
  onSnoozeWake?: (info: { threadId: ThreadId; subject: string; locations: MessageLocation[] }) => void | Promise<void>;
  /** A reminder fired with no reply, or was dropped because a reply arrived. */
  onReminder?: (info: { reminder: Reminder; threadId: ThreadId; outcome: "fired" | "replied"; message: string }) => void | Promise<void>;
  /** The receipts client (ReceiptsClient satisfies this). */
  receipts?: { pollEvents(): Promise<number>; seenPing(): Promise<boolean> };
};

export type SchedulerDeps = {
  store: Store;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => TimerHandle;
  clearTimer: (handle: TimerHandle) => void;
  jobs: SchedulerJobs;
  emit?: (event: FlintEvent) => void;
};

export type JobContext = {
  store: Store;
  now: () => number;
  jobs: SchedulerJobs;
  emit: (event: FlintEvent) => void;
};

export type SendRow = ScheduledSendRow;

export const SEND_RETRY_BACKOFF_MS = [5_000, 30_000, 120_000] as const;
export const POLL_FAST_MS = 10_000;
export const POLL_FAST_WINDOW_MS = 10 * 60_000;
export const POLL_SLOW_MS = 60_000;
export const POLL_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
export const SEEN_PING_MS = 10 * 60_000;
