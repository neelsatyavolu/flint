import { useCallback, useEffect, useReducer, useRef } from "react";
import { FlintError } from "@flint/core/types";
import { flint } from "../../lib/api";
import { useFlintEvent } from "../../lib/hooks";
import { askReducer, historyOf } from "./askState";

/** The Ask conversation: each question is its own streamed run, follow-ups carry the earlier answers as history. */
export function useAsk() {
  const [turns, dispatch] = useReducer(askReducer, []);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const counter = useRef(0);

  useFlintEvent("ai", (e) => dispatch({ type: "chunk", chunk: e.chunk }));

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q) return;
    const id = ++counter.current;
    const history = historyOf(turnsRef.current);
    dispatch({ type: "add", id, question: q });
    try {
      const { runId } = await flint.aiRun({ kind: "ask", question: q, history: history.length ? history : undefined });
      dispatch({ type: "turn", id, action: { type: "started", runId } });
    } catch (err) {
      dispatch({
        type: "turn", id,
        action: {
          type: "failed",
          message: err instanceof Error && err.message ? err.message : "Couldn't ask. Try again.",
          notConnected: err instanceof FlintError && err.code === "ai_not_connected",
        },
      });
    }
  }, []);

  const stop = useCallback(() => {
    for (const t of turnsRef.current) {
      if (t.run.runId && (t.run.status === "running" || t.run.status === "starting")) void flint.aiCancel(t.run.runId).catch(() => undefined);
    }
    dispatch({ type: "cancelAll" });
  }, []);

  const clear = useCallback(() => {
    stop();
    dispatch({ type: "clear" });
  }, [stop]);

  useEffect(() => () => {
    for (const t of turnsRef.current) if (t.run.runId && t.run.status === "running") void flint.aiCancel(t.run.runId).catch(() => undefined);
  }, []);

  return { turns, ask, stop, clear };
}
