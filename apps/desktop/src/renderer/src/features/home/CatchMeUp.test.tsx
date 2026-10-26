import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AiTask, FlintEvent, ThreadPage } from "@flint/core";

const listeners = new Set<(e: FlintEvent) => void>();
const aiRun = vi.fn();
const aiStatus = vi.fn();
const emit = (e: FlintEvent) => act(() => listeners.forEach((l) => l(e)));
const NOW = Date.now();

const page: ThreadPage = {
  items: [{
    id: 9, accountId: "a1", subject: "Lunch", snippet: "", participants: [{ name: "Maria Lopez", address: "maria@x.org" }], lastDate: NOW - 60_000,
    messageCount: 1, unreadCount: 1, hasAttachments: false, pinned: false, muted: false, snoozedUntil: null, category: "people", hasDraft: false, receipt: null,
  }],
  bundles: [{ category: "notifications", unreadCount: 3, totalCount: 5, lastDate: NOW - 60_000, latest: [] }],
  nextCursor: null,
};

vi.mock("../../lib/api", () => ({
  flint: {
    subscribe: (l: (e: FlintEvent) => void) => { listeners.add(l); return () => listeners.delete(l); },
    aiRun: (t: AiTask) => aiRun(t),
    aiStatus: () => aiStatus(),
    aiCancel: () => Promise.resolve(),
    listThreads: () => Promise.resolve(page),
  },
}));

import { navStore } from "../../state/nav";
import { OPEN_SETTINGS_EVENT } from "../ai/events";
import { CatchMeUp } from "./CatchMeUp";
import { catchUp } from "./catchUpStore";
import { HOME_SEEN_KEY } from "./sinceSummary";

beforeEach(() => {
  listeners.clear();
  window.localStorage.clear();
  navStore.getState().go({ view: "home" });
  aiRun.mockReset().mockResolvedValue({ runId: "r1" });
  aiStatus.mockReset().mockResolvedValue({ connected: true, enabled: true, provider: "codex", model: null, models: [] });
});

describe("CatchMeUp", () => {
  it("without +AI, counts what arrived locally and offers to connect", async () => {
    aiStatus.mockResolvedValue({ connected: false, enabled: true, provider: null, model: null, models: [] });
    window.localStorage.setItem(HOME_SEEN_KEY, String(NOW - 3_600_000));
    const opened = vi.fn();
    window.addEventListener(OPEN_SETTINGS_EVENT, opened);
    const { unmount } = render(<CatchMeUp />);
    expect(await screen.findByRole("heading", { level: 2, name: "Catch me up" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Maria wrote" }));
    expect(navStore.getState().view).toBe("inbox");
    expect(screen.getByRole("button", { name: "3 unread notifications" })).toBeTruthy();
    expect(screen.queryByText("+AI")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(opened).toHaveBeenCalled();
    window.removeEventListener(OPEN_SETTINGS_EVENT, opened);
    unmount();
    expect(Number(window.localStorage.getItem(HOME_SEEN_KEY))).toBeGreaterThanOrEqual(NOW);
  });

  it("with +AI, runs automatically, streams a digest from the store and announces when it is ready", async () => {
    render(<CatchMeUp />);
    await screen.findByRole("heading", { level: 2, name: "Catch me up" });
    const stop = catchUp.start();
    await waitFor(() => expect(aiRun).toHaveBeenCalledWith({ kind: "digest" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Writing your catch-up…"));
    emit({ type: "ai", chunk: { runId: "r1", type: "text", text: "Needs a reply\n- Maria asks about lunch. [1]" } });
    emit({ type: "ai", chunk: { runId: "r1", type: "citations", threads: [{ threadId: 9, subject: "Lunch" }] } });
    emit({ type: "ai", chunk: { runId: "r1", type: "done", text: "Needs a reply\n- Maria asks about lunch. [1]" } });
    expect(screen.getByRole("heading", { level: 3, name: "Needs a reply" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Catch-up ready, 1 item");
    expect(screen.getByText(/^Updated /)).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Refresh automatically every 3 hours" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    stop();
  });
});
