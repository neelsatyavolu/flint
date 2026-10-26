import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { msUntilNextTick, useNow } from "./useNow";

describe("msUntilNextTick", () => {
  it("waits for the next whole minute", () => {
    expect(msUntilNextTick(60_000 * 10 + 15_000, 60_000)).toBe(45_000);
    expect(msUntilNextTick(60_000 * 10, 60_000)).toBe(60_000);
  });
});

describe("useNow", () => {
  afterEach(() => vi.useRealTimers());

  it("ticks on the minute boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 25, 9, 59, 40));
    const { result } = renderHook(() => useNow(60_000));
    const start = result.current;
    act(() => void vi.advanceTimersByTime(19_000));
    expect(result.current).toBe(start);
    act(() => void vi.advanceTimersByTime(1_000));
    expect(new Date(result.current).getHours()).toBe(10);
    expect(new Date(result.current).getMinutes()).toBe(0);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(new Date(result.current).getMinutes()).toBe(1);
  });
});
