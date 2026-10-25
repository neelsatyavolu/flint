import { describe, expect, it } from "vitest";
import { askReducer, historyOf, type AskAction, type Turn } from "./askState";

const run = (actions: AskAction[], from: Turn[] = []) => actions.reduce(askReducer, from);

describe("askReducer", () => {
  it("routes chunks to the turn that owns the run id", () => {
    const turns = run([
      { type: "add", id: 1, question: "q1" },
      { type: "turn", id: 1, action: { type: "started", runId: "a" } },
      { type: "chunk", chunk: { runId: "a", type: "text", text: "A1" } },
      { type: "chunk", chunk: { runId: "a", type: "done", text: "A1" } },
      { type: "add", id: 2, question: "q2" },
      { type: "turn", id: 2, action: { type: "started", runId: "b" } },
      { type: "chunk", chunk: { runId: "b", type: "text", text: "B" } },
      { type: "chunk", chunk: { runId: "b", type: "citations", threads: [{ threadId: 9, subject: "S" }] } },
    ]);
    expect(turns[0]!.run).toMatchObject({ status: "done", text: "A1" });
    expect(turns[1]!.run).toMatchObject({ status: "running", text: "B", citations: [{ threadId: 9, subject: "S" }] });
  });

  it("builds history from finished turns only", () => {
    const turns = run([
      { type: "add", id: 1, question: "q1" },
      { type: "turn", id: 1, action: { type: "started", runId: "a" } },
      { type: "chunk", chunk: { runId: "a", type: "done", text: "A1" } },
      { type: "add", id: 2, question: "q2" },
    ]);
    expect(historyOf(turns)).toEqual([{ role: "user", content: "q1" }, { role: "assistant", content: "A1" }]);
  });

  it("cancelAll stops running turns and clear empties", () => {
    const turns = run([{ type: "add", id: 1, question: "q" }, { type: "turn", id: 1, action: { type: "started", runId: "a" } }, { type: "cancelAll" }]);
    expect(turns[0]!.run.status).toBe("idle");
    expect(askReducer(turns, { type: "clear" })).toEqual([]);
  });
});
