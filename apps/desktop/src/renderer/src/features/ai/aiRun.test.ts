import { describe, expect, it } from "vitest";
import type { AiChunk } from "@flint/core";
import { idleRun, isBusy, runReducer, type RunAction, type RunState } from "./aiRun";

const run = (actions: RunAction[], from: RunState = idleRun): RunState => actions.reduce(runReducer, from);
const text = (runId: string, t: string): RunAction => ({ type: "chunk", chunk: { runId, type: "text", text: t } });

describe("runReducer", () => {
  it("accumulates text and finishes with the authoritative done text", () => {
    const s = run([{ type: "start" }, { type: "started", runId: "a" }, text("a", "Hel"), text("a", "lo"), { type: "chunk", chunk: { runId: "a", type: "done", text: "Hello." } }]);
    expect(s.status).toBe("done");
    expect(s.text).toBe("Hello.");
  });

  it("replays chunks that arrived before the run id", () => {
    const s = run([{ type: "start" }, text("a", "one "), text("b", "stray "), { type: "started", runId: "a" }, text("a", "two")]);
    expect(s.text).toBe("one two");
    expect(s.status).toBe("running");
    expect(s.buffered).toEqual([]);
  });

  it("ignores chunks from other runs", () => {
    const s = run([{ type: "start" }, { type: "started", runId: "a" }, text("zzz", "nope"), text("a", "yes")]);
    expect(s.text).toBe("yes");
  });

  it("keeps status notes and citations", () => {
    const chunks: AiChunk[] = [
      { runId: "a", type: "status", text: "Searching your mail" },
      { runId: "a", type: "citations", threads: [{ threadId: 4, subject: "Cycle 3" }] },
    ];
    const s = run([{ type: "start" }, { type: "started", runId: "a" }, ...chunks.map((chunk): RunAction => ({ type: "chunk", chunk }))]);
    expect(s.note).toBe("Searching your mail");
    expect(s.citations).toEqual([{ threadId: 4, subject: "Cycle 3" }]);
  });

  it("records stream errors and start failures", () => {
    const s = run([{ type: "start" }, { type: "started", runId: "a" }, { type: "chunk", chunk: { runId: "a", type: "error", message: "Rate limited" } }]);
    expect(s).toMatchObject({ status: "error", error: "Rate limited" });
    const f = run([{ type: "start" }, { type: "failed", message: "Connect first", notConnected: true }]);
    expect(f).toMatchObject({ status: "error", notConnected: true });
  });

  it("cancel stops a busy run and ignores later chunks", () => {
    const s = run([{ type: "start" }, { type: "started", runId: "a" }, text("a", "x"), { type: "cancel" }, text("a", "y")]);
    expect(s.status).toBe("idle");
    expect(s.text).toBe("x");
    expect(isBusy(s)).toBe(false);
  });

  it("start clears the previous result", () => {
    const done = run([{ type: "start" }, { type: "started", runId: "a" }, text("a", "old")]);
    expect(run([{ type: "start" }], done).text).toBe("");
  });
});
