import { logger } from "../log";
import { ReceiptsCadence } from "./receiptsJob";
import { nextSendAt, recoverInterruptedSends, runSends } from "./sendJob";
import { type JobContext, type SchedulerDeps, type TimerHandle } from "./types";
import { nextReminderAt, nextSnoozeAt, runReminders, runSnoozes } from "./wakeJobs";

const log = logger("scheduler");
/** setTimeout cannot exceed 2^31-1 ms; re-arming hourly also absorbs clock changes and sleep. */
const MAX_DELAY_MS = 60 * 60_000;

/**
 * One timer wheel (SPEC section 5): a single timer is armed for the earliest due item
 * across sends, snoozes, reminders and receipt polling. State lives in the DB, so start() rebuilds it.
 */
export class Scheduler {
  readonly #deps: SchedulerDeps;
  readonly #ctx: JobContext;
  readonly #receipts: ReceiptsCadence;
  #timer: TimerHandle | null = null;
  #running = false;
  #started = false;
  #inFlight: Promise<void> | null = null;

  constructor(deps: SchedulerDeps) {
    this.#deps = deps;
    this.#ctx = { store: deps.store, now: deps.now, jobs: deps.jobs, emit: deps.emit ?? (() => undefined) };
    this.#receipts = new ReceiptsCadence(this.#ctx);
  }

  /**
   * Recovers interrupted sends, runs the local jobs that are already due and arms the timer. The receipts poll and
   * ping are network calls with long timeouts, so they are left to the timer (it fires right after start returns);
   * the app's window never waits for them.
   */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    recoverInterruptedSends(this.#ctx);
    await this.#runOnce(false);
  }

  stop(): void {
    this.#started = false;
    this.#disarm();
  }

  /** Call after changing scheduled sends, snoozes, reminders or tracked messages. */
  poke(): void {
    if (!this.#started) return;
    if (this.#running) return; // the running tick re-arms when it finishes
    this.#arm();
  }

  /** The time the timer is armed for, or null. Exposed for tests and diagnostics. */
  nextDueAt(): number | null {
    const times = [nextSendAt(this.#ctx), nextSnoozeAt(this.#ctx), nextReminderAt(this.#ctx), this.#receipts.nextPollAt(), this.#receipts.nextPingAt()]
      .filter((t): t is number => t !== null);
    return times.length ? Math.min(...times) : null;
  }

  /** Runs everything due now, then re-arms. Overlapping calls share the run in progress. */
  tick(): Promise<void> {
    return this.#runOnce(true);
  }

  #runOnce(withReceipts: boolean): Promise<void> {
    if (this.#inFlight) return this.#inFlight;
    this.#inFlight = this.#tick(withReceipts).finally(() => { this.#inFlight = null; });
    return this.#inFlight;
  }

  async #tick(withReceipts: boolean): Promise<void> {
    this.#disarm();
    this.#running = true;
    try {
      await Promise.all([runSends(this.#ctx), runSnoozes(this.#ctx), runReminders(this.#ctx), withReceipts ? this.#receipts.run() : Promise.resolve()].map((p) =>
        p.catch((err: unknown) => log.error("job failed", { error: err instanceof Error ? err.message : String(err) }))));
    } finally {
      this.#running = false;
      if (this.#started) this.#arm();
    }
  }

  #arm(): void {
    this.#disarm();
    const due = this.nextDueAt();
    if (due === null) return;
    const delay = Math.min(Math.max(0, due - this.#deps.now()), MAX_DELAY_MS);
    this.#timer = this.#deps.setTimer(() => {
      this.#timer = null;
      void this.tick();
    }, delay);
  }

  #disarm(): void {
    if (this.#timer === null) return;
    this.#deps.clearTimer(this.#timer);
    this.#timer = null;
  }
}
