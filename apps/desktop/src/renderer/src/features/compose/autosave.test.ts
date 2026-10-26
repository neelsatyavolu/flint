import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, type SaveState } from "./autosave";

type P = { subject: string; html: string };

describe("createAutosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces 800ms and merges patches", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const states: SaveState[] = [];
    const saver = createAutosaver<P>({ save, onState: (s) => states.push(s) });
    saver.push({ subject: "a" });
    await vi.advanceTimersByTimeAsync(500);
    saver.push({ html: "<p>x</p>" });
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ subject: "a", html: "<p>x</p>" });
    expect(states).toEqual(["saving", "saved"]);
    expect(saver.hasPending()).toBe(false);
  });

  it("flush saves immediately and cancels the timer", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutosaver<P>({ save });
    saver.push({ subject: "b" });
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("batches edits made while a save is in flight into one follow-up save", async () => {
    let release: () => void = () => undefined;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => (release = r))).mockResolvedValue(undefined);
    const saver = createAutosaver<P>({ save });
    saver.push({ subject: "1" });
    await vi.advanceTimersByTimeAsync(800);
    saver.push({ subject: "2" });
    saver.push({ html: "h" });
    const done = saver.flush();
    release();
    await done;
    expect(save.mock.calls.map((c) => c[0])).toEqual([{ subject: "1" }, { subject: "2", html: "h" }]);
  });

  it("keeps the patch after a failure, reports error and rejects flush", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const states: SaveState[] = [];
    const saver = createAutosaver<P>({ save, onState: (s) => states.push(s) });
    saver.push({ subject: "x" });
    await expect(saver.flush()).rejects.toThrow("offline");
    expect(states.at(-1)).toBe("error");
    await saver.flush();
    expect(save).toHaveBeenLastCalledWith({ subject: "x" });
    expect(states.at(-1)).toBe("saved");
  });

  it("retries a failed save after 2s, then 5s, keeping the patch", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const states: SaveState[] = [];
    const saver = createAutosaver<P>({ save, onState: (s) => states.push(s) });
    saver.push({ subject: "r" });
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("error");
    await vi.advanceTimersByTimeAsync(1999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4999);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenLastCalledWith({ subject: "r" });
    expect(states.at(-1)).toBe("saved");
    expect(saver.hasPending()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("gives up after the 15s retry until the next edit, which starts the schedule over", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    const saver = createAutosaver<P>({ save });
    saver.push({ subject: "a" });
    await vi.advanceTimersByTimeAsync(800 + 2000 + 5000 + 15000);
    expect(save).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(4);
    saver.push({ html: "h" });
    await vi.advanceTimersByTimeAsync(800 + 2000);
    expect(save).toHaveBeenCalledTimes(6);
    expect(save).toHaveBeenLastCalledWith({ subject: "a", html: "h" });
    saver.cancel();
  });

  it("does not retry after cancel", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    const saver = createAutosaver<P>({ save });
    saver.push({ subject: "c" });
    await vi.advanceTimersByTimeAsync(800);
    saver.cancel();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flushes unsaved work when the page is hidden or unloaded", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosaver<P>({ save });
    const b = createAutosaver<P>({ save });
    a.push({ subject: "a" });
    b.push({ subject: "b" });
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.calls.map((c) => c[0])).toEqual([{ subject: "a" }, { subject: "b" }]);
    a.push({ html: "x" });
    window.dispatchEvent(new Event("beforeunload"));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenLastCalledWith({ html: "x" });
  });

  it("cancel drops pending work", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutosaver<P>({ save });
    saver.push({ subject: "z" });
    saver.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
  });
});
