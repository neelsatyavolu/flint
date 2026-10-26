import { useEffect, useState } from "react";

/** Milliseconds until the next multiple of `interval` (the next whole minute for 60_000). */
export function msUntilNextTick(now: number, interval: number): number {
  return interval - (now % interval) || interval;
}

/**
 * The current time, updated on each `interval` boundary (whole minutes for 60_000), so a clock flips with the
 * system clock instead of up to a minute late. Re-aligns after every tick, which also absorbs sleep and drift.
 */
export function useNow(interval = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, msUntilNextTick(Date.now(), interval));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [interval]);
  return now;
}
