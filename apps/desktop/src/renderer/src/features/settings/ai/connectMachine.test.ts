import { describe, expect, it } from "vitest";
import { connectReducer, type ConnectState } from "./connectMachine";

const idle: ConnectState = { kind: "idle" };

describe("connectReducer", () => {
  it("codex goes starting -> waiting", () => {
    const s1 = connectReducer(idle, { type: "start", provider: "codex" });
    expect(s1).toEqual({ kind: "starting", provider: "codex" });
    const s2 = connectReducer(s1, { type: "started", url: "u", needsPaste: false, now: 5 });
    expect(s2).toEqual({ kind: "waiting", provider: "codex", url: "u", startedAt: 5 });
  });

  it("grok goes starting -> paste", () => {
    const s = connectReducer(connectReducer(idle, { type: "start", provider: "grok" }), { type: "started", url: "u", needsPaste: true, now: 1 });
    expect(s).toMatchObject({ kind: "paste", provider: "grok", fallback: false, busy: false });
  });

  it("waiting can fall back to paste", () => {
    const w: ConnectState = { kind: "waiting", provider: "codex", url: "u", startedAt: 0 };
    expect(connectReducer(w, { type: "usePaste" })).toMatchObject({ kind: "paste", fallback: true });
  });

  it("paste tracks submit and failure", () => {
    const p: ConnectState = { kind: "paste", provider: "grok", url: "u", busy: false, error: null, fallback: false };
    const busy = connectReducer(p, { type: "submit" });
    expect(busy).toMatchObject({ busy: true });
    expect(connectReducer(busy, { type: "submitFailed", message: "bad" })).toMatchObject({ busy: false, error: "bad" });
  });

  it("timeout only applies while waiting", () => {
    expect(connectReducer(idle, { type: "timeout" })).toBe(idle);
    const w: ConnectState = { kind: "waiting", provider: "codex", url: "u", startedAt: 0 };
    expect(connectReducer(w, { type: "timeout" })).toMatchObject({ kind: "error", provider: "codex" });
  });

  it("failed reports the provider that was starting and reset clears", () => {
    const s = connectReducer({ kind: "starting", provider: "grok" }, { type: "failed", message: "no" });
    expect(s).toEqual({ kind: "error", provider: "grok", message: "no" });
    expect(connectReducer(s, { type: "reset" })).toEqual(idle);
  });

  it("ignores started when not starting", () => {
    expect(connectReducer(idle, { type: "started", url: "u", needsPaste: false, now: 1 })).toBe(idle);
  });
});
