import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AiTask, FlintEvent, Settings } from "@flint/core";

const listeners = new Set<(e: FlintEvent) => void>();
const aiRun = vi.fn();
const aiStatus = vi.fn();
const emit = (e: FlintEvent) => act(() => listeners.forEach((l) => l(e)));

vi.mock("../../lib/api", () => ({
  flint: {
    subscribe: (l: (e: FlintEvent) => void) => { listeners.add(l); return () => listeners.delete(l); },
    aiRun: (t: AiTask) => aiRun(t),
    aiStatus: () => aiStatus(),
    aiCancel: () => Promise.resolve(),
    getThread: (id: number) => Promise.resolve({ id, messages: [] }),
    getSettings: () => Promise.resolve({ ai: { enabled: true, autoSummarize: true, smartReplies: true } } as Settings),
  },
}));

import { QUICK_REPLIES_DWELL_MS, QuickReplies } from "./QuickReplies";
import { ThreadSummary } from "./ThreadSummary";

beforeEach(() => {
  listeners.clear();
  aiRun.mockReset().mockResolvedValue({ runId: "r1" });
  aiStatus.mockReset().mockResolvedValue({ connected: true, enabled: true, provider: "codex", model: null, models: [] });
});

describe("QuickReplies", () => {
  it("shows three chips from the stream and reports the pick", async () => {
    const onPick = vi.fn();
    render(<QuickReplies threadId={101} onPick={onPick} />);
    await waitFor(() => expect(aiRun).toHaveBeenCalledWith({ kind: "quickReplies", threadId: 101 }), { timeout: 3000 });
    emit({ type: "ai", chunk: { runId: "r1", type: "done", text: '["Yes.","No.","Later."]' } });
    fireEvent.click(await screen.findByRole("button", { name: "No." }));
    expect(onPick).toHaveBeenCalledWith("No.");
  });

  it("does not call the model when the thread is closed before the dwell time", async () => {
    const { unmount } = render(<QuickReplies threadId={202} onPick={vi.fn()} />);
    await waitFor(() => expect(aiStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 100));
    unmount();
    await new Promise((r) => setTimeout(r, QUICK_REPLIES_DWELL_MS + 100));
    expect(aiRun).not.toHaveBeenCalled();
  });

  it("renders nothing when AI is not connected", async () => {
    aiStatus.mockResolvedValue({ connected: false, enabled: true, provider: null, model: null, models: [] });
    const { container } = render(<QuickReplies threadId={102} onPick={() => undefined} />);
    await waitFor(() => expect(aiStatus).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    expect(aiRun).not.toHaveBeenCalled();
  });
});

describe("ThreadSummary", () => {
  it("skips short threads", async () => {
    const { container } = render(<ThreadSummary threadId={1} messageCount={2} wordCount={50} />);
    await waitFor(() => expect(aiStatus).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    expect(aiRun).not.toHaveBeenCalled();
  });

  it("streams a summary for long threads and collapses", async () => {
    render(<ThreadSummary threadId={7} messageCount={4} wordCount={100} />);
    await waitFor(() => expect(aiRun).toHaveBeenCalledWith({ kind: "summarize", threadId: 7 }));
    emit({ type: "ai", chunk: { runId: "r1", type: "text", text: "They agreed on scope." } });
    expect(await screen.findByText("They agreed on scope.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /summary/i }));
    expect(screen.queryByText("They agreed on scope.")).toBeNull();
  });
});
