import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AiStatus } from "@flint/core";
import { flint } from "../../../lib/api";
import * as host from "../../../lib/host";
import { useAiConnect } from "./useAiConnect";

const connected = (provider: "codex" | "grok"): AiStatus => ({ provider, connected: true, model: "m", models: [], enabled: true });
const idle: AiStatus = { provider: null, connected: false, model: null, models: [], enabled: true };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(host, "openExternal").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAiConnect", () => {
  it("codex: opens the url, polls every 2s and finishes when connected", async () => {
    vi.spyOn(flint, "aiStartConnect").mockResolvedValue({ url: "https://auth.example.com/x", needsPaste: false });
    const poll = vi.spyOn(flint, "aiStatus").mockResolvedValueOnce(idle).mockResolvedValue(connected("codex"));
    const done = vi.fn();
    const { result } = renderHook(() => useAiConnect(done));
    await act(async () => { await result.current.start("codex"); });
    expect(host.openExternal).toHaveBeenCalledWith("https://auth.example.com/x");
    expect(result.current.state.kind).toBe("waiting");
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(done).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(poll).toHaveBeenCalledTimes(2);
    expect(done).toHaveBeenCalledTimes(1);
    expect(result.current.state.kind).toBe("idle");
  });

  it("times out after the wait limit", async () => {
    vi.spyOn(flint, "aiStartConnect").mockResolvedValue({ url: "https://a.example.com", needsPaste: false });
    vi.spyOn(flint, "aiStatus").mockResolvedValue(idle);
    const { result } = renderHook(() => useAiConnect(() => {}, { pollMs: 1000, timeoutMs: 5000 }));
    await act(async () => { await result.current.start("codex"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(result.current.state.kind).toBe("error");
  });

  it("grok: asks for the code and connects with it", async () => {
    vi.spyOn(flint, "aiStartConnect").mockResolvedValue({ url: "https://g.example.com", needsPaste: true });
    const finish = vi.spyOn(flint, "aiFinishConnect").mockResolvedValue(connected("grok"));
    const done = vi.fn();
    const { result } = renderHook(() => useAiConnect(done));
    await act(async () => { await result.current.start("grok"); });
    expect(result.current.state.kind).toBe("paste");
    await act(async () => { await result.current.submit("  abc123 "); });
    expect(finish).toHaveBeenCalledWith("grok", "abc123");
    expect(done).toHaveBeenCalled();
  });

  it("keeps the paste form with a message when the code is wrong", async () => {
    vi.spyOn(flint, "aiStartConnect").mockResolvedValue({ url: "https://g.example.com", needsPaste: true });
    vi.spyOn(flint, "aiFinishConnect").mockRejectedValue(new Error("That code is not valid."));
    const { result } = renderHook(() => useAiConnect(() => {}));
    await act(async () => { await result.current.start("grok"); });
    await act(async () => { await result.current.submit("bad"); });
    expect(result.current.state).toMatchObject({ kind: "paste", error: "That code is not valid." });
  });

  it("fails cleanly when sign-in cannot start, and the paste fallback works for codex", async () => {
    vi.spyOn(flint, "aiStartConnect").mockRejectedValueOnce(new Error("No network."));
    const { result } = renderHook(() => useAiConnect(() => {}));
    await act(async () => { await result.current.start("codex"); });
    expect(result.current.state).toMatchObject({ kind: "error", message: "No network." });
    vi.spyOn(flint, "aiStartConnect").mockResolvedValue({ url: "https://a.example.com", needsPaste: false });
    await act(async () => { await result.current.start("codex"); });
    act(() => result.current.switchToPaste());
    expect(result.current.state.kind).toBe("paste");
  });
});
