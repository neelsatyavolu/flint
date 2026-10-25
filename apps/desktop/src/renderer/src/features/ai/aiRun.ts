import type { AiChunk } from "@flint/core";

export type Citation = { threadId: number; subject: string };

export type RunState = {
  status: "idle" | "starting" | "running" | "done" | "error";
  runId: string | null;
  text: string;
  /** Latest status line from the backend ("Searching your mail"). */
  note: string;
  citations: Citation[];
  error: string | null;
  /** The provider isn't connected; the UI shows the connect prompt instead of an error. */
  notConnected: boolean;
  /** Chunks that arrived before aiRun returned its runId. */
  buffered: AiChunk[];
};

export type RunAction =
  | { type: "start" }
  | { type: "started"; runId: string }
  | { type: "chunk"; chunk: AiChunk }
  | { type: "failed"; message: string; notConnected?: boolean }
  | { type: "cancel" }
  | { type: "reset" };

export const idleRun: RunState = {
  status: "idle", runId: null, text: "", note: "", citations: [], error: null, notConnected: false, buffered: [],
};

function applyChunk(state: RunState, chunk: AiChunk): RunState {
  switch (chunk.type) {
    case "text":
      return { ...state, text: state.text + chunk.text };
    case "status":
      return { ...state, note: chunk.text };
    case "citations":
      return { ...state, citations: chunk.threads.map((t) => ({ threadId: t.threadId, subject: t.subject })) };
    case "done":
      return { ...state, status: "done", text: chunk.text || state.text, note: "" };
    case "error":
      return { ...state, status: "error", error: chunk.message, note: "" };
  }
}

/** Pure reducer for one streamed AI run. Chunks for other runs are ignored; early chunks wait for the run id. */
export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "start":
      return { ...idleRun, status: "starting" };
    case "started": {
      if (state.status !== "starting") return state;
      const running: RunState = { ...state, status: "running", runId: action.runId, buffered: [] };
      return state.buffered.filter((c) => c.runId === action.runId).reduce(applyChunk, running);
    }
    case "chunk": {
      if (state.status === "starting") return { ...state, buffered: [...state.buffered, action.chunk] };
      if (state.status !== "running" || action.chunk.runId !== state.runId) return state;
      return applyChunk(state, action.chunk);
    }
    case "failed":
      return { ...idleRun, status: "error", error: action.message, notConnected: action.notConnected === true };
    case "cancel":
      return state.status === "starting" || state.status === "running" ? { ...state, status: "idle", note: "", buffered: [] } : state;
    case "reset":
      return idleRun;
  }
}

export const isBusy = (s: RunState): boolean => s.status === "starting" || s.status === "running";
