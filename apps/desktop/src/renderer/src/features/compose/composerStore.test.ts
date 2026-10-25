import { beforeEach, describe, expect, it, vi } from "vitest";

const createDraft = vi.fn();
const getDraft = vi.fn();
vi.mock("../../lib/api", () => ({ flint: { createDraft: (...a: unknown[]) => createDraft(...a), getDraft: (...a: unknown[]) => getDraft(...a) } }));

import { closeComposer, ensureDraft, minimizeComposer, openComposer, resetComposerStore, restoreComposer, setComposerMeta, useComposers } from "./composerStore";
import { act, renderHook } from "@testing-library/react";

const read = () => renderHook(() => useComposers()).result.current;

describe("composerStore", () => {
  beforeEach(() => {
    resetComposerStore();
    createDraft.mockReset().mockResolvedValue({ id: 7 });
    getDraft.mockReset().mockResolvedValue({ id: 9 });
  });

  it("minimizes the open composer when a new one opens", () => {
    openComposer({ mode: "new" });
    openComposer({ mode: "new", subject: "B" });
    const list = read();
    expect(list.map((c) => c.minimized)).toEqual([true, false]);
  });

  it("restore swaps which composer is in front", () => {
    openComposer({ mode: "new" });
    openComposer({ mode: "new" });
    const [a] = read();
    act(() => restoreComposer(a!.id));
    expect(read().map((c) => c.minimized)).toEqual([false, true]);
    act(() => minimizeComposer(a!.id));
    expect(read().every((c) => c.minimized)).toBe(true);
  });

  it("close removes the entry; meta updates only on change", () => {
    openComposer({ mode: "new" });
    const [a] = read();
    act(() => setComposerMeta(a!.id, { draftId: 3, label: "Hello" }));
    expect(read()[0]).toMatchObject({ draftId: 3, label: "Hello" });
    act(() => closeComposer(a!.id));
    expect(read()).toHaveLength(0);
  });

  it("reopening a draft that is already open restores it instead of duplicating", () => {
    openComposer({ draftId: 5 });
    openComposer({ mode: "new" });
    openComposer({ draftId: 5 });
    const list = read();
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.minimized)).toEqual([false, true]);
  });

  it("creates the draft once per composer", async () => {
    openComposer({ mode: "new" });
    const [a] = read();
    const [d1, d2] = await Promise.all([ensureDraft(a!), ensureDraft(a!)]);
    expect(d1).toBe(d2);
    expect(createDraft).toHaveBeenCalledTimes(1);
    openComposer({ draftId: 9 });
    const b = read()[1]!;
    await ensureDraft(b);
    expect(getDraft).toHaveBeenCalledWith(9);
  });

  it("forgets a failed creation so it can be retried", async () => {
    createDraft.mockRejectedValueOnce(new Error("x"));
    openComposer({ mode: "new" });
    const [a] = read();
    await expect(ensureDraft(a!)).rejects.toThrow("x");
    await Promise.resolve();
    await expect(ensureDraft(a!)).resolves.toEqual({ id: 7 });
  });
});
