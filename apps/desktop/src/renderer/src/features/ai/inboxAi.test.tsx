import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AiTask, FlintEvent } from "@flint/core";

const listeners = new Set<(e: FlintEvent) => void>();
const aiRun = vi.fn();
const aiStatus = vi.fn();
const aiRunToText = vi.fn();
const getThread = vi.fn();
const emit = (e: FlintEvent) => act(() => listeners.forEach((l) => l(e)));

vi.mock("../../lib/api", () => ({
  flint: {
    subscribe: (l: (e: FlintEvent) => void) => { listeners.add(l); return () => listeners.delete(l); },
    aiRun: (t: AiTask) => aiRun(t),
    aiRunToText: (t: AiTask) => aiRunToText(t),
    aiStatus: () => aiStatus(),
    aiCancel: () => Promise.resolve(),
    getThread: (id: number) => getThread(id),
  },
}));

import { navStore } from "../../state/nav";
import { CatchMeUp } from "../home/CatchMeUp";
import { NeedsReply } from "../home/NeedsReply";
import { BundleSummary } from "./BundleSummary";
import { TRANSLATE_PROBE_DELAY_MS, ThreadTranslate } from "./ThreadTranslate";

const connected = { connected: true, enabled: true, provider: "codex", model: null, models: [] };
const spanish = "Hola Sam, gracias por enviar esto. ¿Puedes confirmar que la reunión sigue en pie para el jueves? Voy a traer las notas de la última llamada y las podemos revisar con el equipo, pero no tengo mucho tiempo.";
const english = "Hi Sam, thanks for sending this over. Can you please confirm that the meeting is still on for Thursday? I will bring the notes from the last call and we can go through them together with the team.";
const thread = (id: number, text: string) => ({
  id, messages: [{ id: 1, text, html: null, isFromMe: false, from: [{ name: "Ana", address: "ana@x.com" }] }],
});

beforeEach(() => {
  cleanup();
  listeners.clear();
  aiRun.mockReset().mockResolvedValue({ runId: "r1" });
  aiRunToText.mockReset();
  aiStatus.mockReset().mockResolvedValue(connected);
  getThread.mockReset();
  navStore.setState({ openId: null });
});

describe("ThreadTranslate", () => {
  it("offers a translation for a thread in another language and streams it in", async () => {
    getThread.mockResolvedValue(thread(31, spanish));
    render(<ThreadTranslate threadId={31} />);
    const button = await screen.findByRole("button", { name: /translate to english/i }, { timeout: TRANSLATE_PROBE_DELAY_MS + 2000 });
    expect(screen.getByText(/looks like spanish/i)).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(aiRun).toHaveBeenCalledWith({ kind: "translate", threadId: 31, language: "English" }));
    emit({ type: "ai", chunk: { runId: "r1", type: "text", text: "Hi Sam, thanks for sending this." } });
    expect(await screen.findByText("Hi Sam, thanks for sending this.")).toBeTruthy();
    expect(screen.getByRole("region", { name: /translation to english/i })).toBeTruthy();
  });

  it("stays out of the way for a thread already in the user's language", async () => {
    getThread.mockResolvedValue(thread(32, english));
    const { container } = render(<ThreadTranslate threadId={32} />);
    await waitFor(() => expect(getThread).toHaveBeenCalled(), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
    expect(aiRun).not.toHaveBeenCalled();
  });
});

describe("CatchMeUp", () => {
  it("does nothing until asked, then lists items that open their threads", async () => {
    render(<CatchMeUp />);
    const ask = await screen.findByRole("button", { name: /catch me up/i });
    expect(aiRun).not.toHaveBeenCalled();
    fireEvent.click(ask);
    await waitFor(() => expect(aiRun).toHaveBeenCalledWith({ kind: "digest" }));
    emit({ type: "ai", chunk: { runId: "r1", type: "text", text: "Needs a reply\n- Rodney asks you to confirm Monday. [1]\nWorth knowing\n- The invoice was approved. [2]" } });
    emit({ type: "ai", chunk: { runId: "r1", type: "citations", threads: [{ threadId: 11, subject: "Agreement" }, { threadId: 12, subject: "Invoice 2291" }] } });
    emit({ type: "ai", chunk: { runId: "r1", type: "done", text: "" } });
    fireEvent.click(await screen.findByRole("button", { name: /rodney asks you to confirm monday/i }));
    expect(navStore.getState().openId).toBe(11);
  });

  it("is hidden when AI is off", async () => {
    aiStatus.mockResolvedValue({ ...connected, enabled: false });
    const { container } = render(<CatchMeUp />);
    await waitFor(() => expect(aiStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.firstChild).toBeNull();
  });
});

describe("NeedsReply", () => {
  const rows = [{ threadId: 5, subject: "Plan for Thursday", from: { name: "Ana Lima", address: "ana@x.com" }, date: Date.now() - 3_600_000, unreadCount: 1, reason: "question" }];

  it("lists threads that wait on an answer and opens one", async () => {
    aiRunToText.mockResolvedValue({ text: JSON.stringify(rows) });
    render(<NeedsReply now={Date.now()} />);
    fireEvent.click(await screen.findByRole("button", { name: /plan for thursday/i }));
    expect(navStore.getState().openId).toBe(5);
    expect(aiRunToText).toHaveBeenCalledWith({ kind: "needsReply" });
  });

  it("renders nothing when AI is off or the list is empty", async () => {
    aiStatus.mockResolvedValue({ ...connected, enabled: false });
    const off = render(<NeedsReply now={Date.now()} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(off.container.firstChild).toBeNull();
    expect(aiRunToText).not.toHaveBeenCalled();
    off.unmount();
    aiStatus.mockResolvedValue(connected);
    aiRunToText.mockResolvedValue({ text: "[]" });
    const empty = render(<NeedsReply now={Date.now()} />);
    await waitFor(() => expect(aiRunToText).toHaveBeenCalled());
    expect(empty.container.firstChild).toBeNull();
  });
});

describe("BundleSummary", () => {
  it("summarizes the bundle when opened and links bullets to threads", async () => {
    render(<BundleSummary category="notifications" />);
    fireEvent.click(await screen.findByRole("button", { name: /summarize notifications/i }));
    await waitFor(() => expect(aiRun).toHaveBeenCalledWith({ kind: "summarizeBundle", category: "notifications" }));
    emit({ type: "ai", chunk: { runId: "r1", type: "text", text: "- Your order shipped. [1]\nThe rest is routine." } });
    emit({ type: "ai", chunk: { runId: "r1", type: "citations", threads: [{ threadId: 21, subject: "Order shipped" }] } });
    emit({ type: "ai", chunk: { runId: "r1", type: "done", text: "" } });
    fireEvent.click(await screen.findByRole("button", { name: /your order shipped/i }));
    expect(navStore.getState().openId).toBe(21);
  });

  it("is hidden while AI is not connected", async () => {
    aiStatus.mockResolvedValue({ ...connected, connected: false });
    const { container } = render(<BundleSummary category="newsletters" />);
    await waitFor(() => expect(aiStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.firstChild).toBeNull();
  });
});
