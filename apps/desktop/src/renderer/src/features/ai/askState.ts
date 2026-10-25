import type { AiChunk } from "@flint/core";
import { idleRun, runReducer, type RunAction, type RunState } from "./aiRun";

export type Turn = { id: number; question: string; run: RunState };

export type AskAction =
  | { type: "add"; id: number; question: string }
  | { type: "turn"; id: number; action: RunAction }
  | { type: "chunk"; chunk: AiChunk }
  | { type: "cancelAll" }
  | { type: "clear" };

export function askReducer(turns: Turn[], action: AskAction): Turn[] {
  switch (action.type) {
    case "add":
      return [...turns, { id: action.id, question: action.question, run: runReducer(idleRun, { type: "start" }) }];
    case "turn":
      return turns.map((t) => (t.id === action.id ? { ...t, run: runReducer(t.run, action.action) } : t));
    case "chunk":
      return turns.map((t) => ({ ...t, run: runReducer(t.run, { type: "chunk", chunk: action.chunk }) }));
    case "cancelAll":
      return turns.map((t) => ({ ...t, run: runReducer(t.run, { type: "cancel" }) }));
    case "clear":
      return [];
  }
}

/** Earlier finished turns as the history the backend expects for a follow-up question. */
export function historyOf(turns: Turn[]): { role: "user" | "assistant"; content: string }[] {
  return turns
    .filter((t) => t.run.status === "done" && t.run.text.trim() !== "")
    .flatMap((t) => [
      { role: "user" as const, content: t.question },
      { role: "assistant" as const, content: t.run.text },
    ]);
}
