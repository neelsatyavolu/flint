import { useCallback, useEffect, useReducer, useRef } from "react";
import { FlintError } from "@flint/core/types";
import type { AiStatus, AiTask } from "@flint/core";
import { flint } from "../../lib/api";
import { useFlintEvent, useFlintQuery } from "../../lib/hooks";
import { idleRun, isBusy, runReducer, type RunState } from "./aiRun";

const messageOf = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : "The AI request failed. Try again.";

/** One streamed AI run at a time. Chunks arrive as 'ai' events; the reducer sorts out ordering. */
export function useAiRun(): { state: RunState; start: (task: AiTask) => Promise<void>; cancel: () => void; reset: () => void } {
  const [state, dispatch] = useReducer(runReducer, idleRun);
  const stateRef = useRef(state);
  stateRef.current = state;
  const seq = useRef(0);

  useFlintEvent("ai", (e) => dispatch({ type: "chunk", chunk: e.chunk }));

  const cancel = useCallback(() => {
    seq.current++;
    const { runId } = stateRef.current;
    if (runId && isBusy(stateRef.current)) void flint.aiCancel(runId).catch(() => undefined);
    dispatch({ type: "cancel" });
  }, []);

  const start = useCallback(async (task: AiTask) => {
    const mine = ++seq.current;
    dispatch({ type: "start" });
    try {
      const { runId } = await flint.aiRun(task);
      if (mine !== seq.current) {
        void flint.aiCancel(runId).catch(() => undefined);
        return;
      }
      dispatch({ type: "started", runId });
    } catch (err) {
      if (mine === seq.current) dispatch({ type: "failed", message: messageOf(err), notConnected: err instanceof FlintError && err.code === "ai_not_connected" });
    }
  }, []);

  const reset = useCallback(() => {
    seq.current++;
    dispatch({ type: "reset" });
  }, []);

  useEffect(() => () => {
    seq.current++;
    const { runId } = stateRef.current;
    if (runId && isBusy(stateRef.current)) void flint.aiCancel(runId).catch(() => undefined);
  }, []);

  return { state, start, cancel, reset };
}

export type AiAvailability = { status: AiStatus | undefined; loading: boolean; connected: boolean; enabled: boolean; ready: boolean };

/** Whether AI features should show: a provider is connected and the user hasn't turned AI off. */
export function useAiAvailability(): AiAvailability {
  const q = useFlintQuery((api) => api.aiStatus(), [], { refetchOn: ["settings"] });
  const connected = q.data?.connected === true;
  const enabled = q.data?.enabled === true;
  return { status: q.data, loading: q.loading && !q.data, connected, enabled, ready: connected && enabled };
}
