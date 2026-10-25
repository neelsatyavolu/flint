import type { TimerHandle } from "./types";

/** Manual clock and timer set for deterministic scheduler tests. */
export class FakeClock {
  now: number;
  #seq = 0;
  readonly timers = new Map<number, { at: number; fn: () => void }>();

  constructor(start: number) {
    this.now = start;
  }

  readonly nowFn = (): number => this.now;
  readonly setTimer = (fn: () => void, ms: number): TimerHandle => {
    const id = ++this.#seq;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  };
  readonly clearTimer = (h: TimerHandle): void => { this.timers.delete(h as number); };

  /** Delay of the single armed timer, or null. Throws if more than one is armed. */
  get armedIn(): number | null {
    if (this.timers.size > 1) throw new Error(`expected one timer, found ${this.timers.size}`);
    const t = [...this.timers.values()][0];
    return t ? t.at - this.now : null;
  }

  /** Moves time forward, firing due timers in order and letting async work settle after each. */
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.timers.delete(next[0]);
      this.now = Math.max(this.now, next[1].at);
      next[1].fn();
      await this.settle();
    }
    this.now = end;
  }

  async settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise<void>((r) => setImmediate(r));
  }
}
