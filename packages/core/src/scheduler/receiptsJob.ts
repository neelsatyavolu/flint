import { logger } from "../log";
import { POLL_FAST_MS, POLL_FAST_WINDOW_MS, POLL_MAX_AGE_MS, POLL_SLOW_MS, SEEN_PING_MS, type JobContext } from "./types";

const log = logger("scheduler");

/** Polling cadence and ping bookkeeping. Times are in-memory: after a restart both run immediately. */
export class ReceiptsCadence {
  #lastPoll: number | null = null;
  #lastPing: number | null = null;

  constructor(private readonly ctx: JobContext) {}

  /** Poll interval right now, or null when no tracked message is young enough. */
  #interval(): number | null {
    const now = this.ctx.now();
    if (this.ctx.store.listPollable(now - POLL_FAST_WINDOW_MS).length > 0) return POLL_FAST_MS;
    return this.ctx.store.listPollable(now - POLL_MAX_AGE_MS).length > 0 ? POLL_SLOW_MS : null;
  }

  nextPollAt(): number | null {
    if (!this.ctx.jobs.receipts) return null;
    const interval = this.#interval();
    if (interval === null) return null;
    return this.#lastPoll === null ? this.ctx.now() : this.#lastPoll + interval;
  }

  nextPingAt(): number | null {
    if (!this.ctx.jobs.receipts || this.#interval() === null) return null;
    return this.#lastPing === null ? this.ctx.now() : this.#lastPing + SEEN_PING_MS;
  }

  async run(): Promise<void> {
    const receipts = this.ctx.jobs.receipts;
    if (!receipts) return;
    const now = this.ctx.now();
    const poll = this.nextPollAt();
    if (poll !== null && poll <= now) {
      this.#lastPoll = now;
      try {
        await receipts.pollEvents();
      } catch (err) {
        log.warn("receipt poll failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }
    const ping = this.nextPingAt();
    if (ping !== null && ping <= now) {
      this.#lastPing = now;
      try {
        await receipts.seenPing();
      } catch (err) {
        log.warn("seen ping failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}
