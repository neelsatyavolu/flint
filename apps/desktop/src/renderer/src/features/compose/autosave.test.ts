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

  it("cancel drops pending work", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutosaver<P>({ save });
    saver.push({ subject: "z" });
    saver.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
  });
});
