import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AiProvider, AiStatus } from "@flint/core";
import { flint } from "../../../lib/api";
import { openExternal } from "../../../lib/host";
import { errorText } from "../useAccounts";
import { connectReducer, POLL_MS, POLL_TIMEOUT_MS, type ConnectState } from "./connectMachine";

export type AiConnect = {
  state: ConnectState;
  start: (provider: AiProvider) => Promise<void>;
  submit: (pasted: string) => Promise<void>;
  switchToPaste: () => void;
  cancel: () => void;
};

export function useAiConnect(onConnected: (status: AiStatus) => void, opts: { pollMs?: number; timeoutMs?: number } = {}): AiConnect {
  const { pollMs = POLL_MS, timeoutMs = POLL_TIMEOUT_MS } = opts;
  const [state, dispatch] = useReducer(connectReducer, { kind: "idle" } as ConnectState);
  const done = useRef(onConnected);
  done.current = onConnected;

  const waitingSince = state.kind === "waiting" ? state.startedAt : null;
  const waitingProvider = state.kind === "waiting" ? state.provider : null;
  useEffect(() => {
    if (waitingSince === null || waitingProvider === null) return;
    let stopped = false;
    const tick = async () => {
      if (Date.now() - waitingSince >= timeoutMs) {
        dispatch({ type: "timeout" });
        return;
      }
      try {
        const status = await flint.aiStatus();
        if (stopped) return;
        if (status.connected && status.provider === waitingProvider) {
          dispatch({ type: "reset" });
          done.current(status);
        }
      } catch {
        // A failed poll is retried on the next tick; the timeout ends the wait.
      }
    };
    const id = setInterval(() => void tick(), pollMs);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [waitingSince, waitingProvider, pollMs, timeoutMs]);

  const start = useCallback(async (provider: AiProvider) => {
    dispatch({ type: "start", provider });
    try {
      const { url, needsPaste } = await flint.aiStartConnect(provider);
      dispatch({ type: "started", url, needsPaste, now: Date.now() });
      openExternal(url);
    } catch (err) {
      dispatch({ type: "failed", message: errorText(err, "Couldn't start sign-in. Try again.") });
    }
  }, []);

  const submit = useCallback(
    async (pasted: string) => {
      if (state.kind !== "paste") return;
      const provider = state.provider;
      dispatch({ type: "submit" });
      try {
        const status = await flint.aiFinishConnect(provider, pasted.trim());
        dispatch({ type: "reset" });
        done.current(status);
      } catch (err) {
        dispatch({ type: "submitFailed", message: errorText(err, "That didn't work. Copy it again from the browser and paste it here.") });
      }
    },
    [state],
  );

  return {
    state,
    start,
    submit,
    switchToPaste: useCallback(() => dispatch({ type: "usePaste" }), []),
    cancel: useCallback(() => dispatch({ type: "reset" }), []),
  };
}
