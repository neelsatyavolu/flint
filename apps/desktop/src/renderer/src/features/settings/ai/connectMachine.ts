import type { AiProvider } from "@flint/core";

/** Sign-in flow for +AI. Connected state itself comes from aiStatus, not from here. */
export type ConnectState =
  | { kind: "idle" }
  | { kind: "starting"; provider: AiProvider }
  /** Codex: the browser finishes sign-in on the localhost callback; Flint polls aiStatus. */
  | { kind: "waiting"; provider: AiProvider; url: string; startedAt: number }
  /** Paste a code (Grok) or the callback link (Codex fallback). */
  | { kind: "paste"; provider: AiProvider; url: string; busy: boolean; error: string | null; fallback: boolean }
  | { kind: "error"; provider: AiProvider; message: string };

export type ConnectAction =
  | { type: "start"; provider: AiProvider }
  | { type: "started"; url: string; needsPaste: boolean; now: number }
  | { type: "failed"; message: string }
  | { type: "usePaste" }
  | { type: "submit" }
  | { type: "submitFailed"; message: string }
  | { type: "timeout" }
  | { type: "reset" };

export function connectReducer(state: ConnectState, action: ConnectAction): ConnectState {
  switch (action.type) {
    case "start":
      return { kind: "starting", provider: action.provider };
    case "started":
      if (state.kind !== "starting") return state;
      return action.needsPaste
        ? { kind: "paste", provider: state.provider, url: action.url, busy: false, error: null, fallback: false }
        : { kind: "waiting", provider: state.provider, url: action.url, startedAt: action.now };
    case "failed":
      return state.kind === "idle" ? state : { kind: "error", provider: "provider" in state ? state.provider : "codex", message: action.message };
    case "usePaste":
      return state.kind === "waiting" ? { kind: "paste", provider: state.provider, url: state.url, busy: false, error: null, fallback: true } : state;
    case "submit":
      return state.kind === "paste" ? { ...state, busy: true, error: null } : state;
    case "submitFailed":
      return state.kind === "paste" ? { ...state, busy: false, error: action.message } : state;
    case "timeout":
      return state.kind === "waiting"
        ? { kind: "error", provider: state.provider, message: "Sign-in timed out after 5 minutes. Connect again, or paste the link instead." }
        : state;
    case "reset":
      return { kind: "idle" };
  }
}

export const PROVIDER_LABEL: Record<AiProvider, string> = { codex: "ChatGPT", grok: "Grok" };
export const POLL_MS = 2000;
export const POLL_TIMEOUT_MS = 5 * 60 * 1000;
