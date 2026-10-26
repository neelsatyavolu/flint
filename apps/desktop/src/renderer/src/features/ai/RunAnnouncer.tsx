import type { JSX } from "react";
import { isBusy, type RunState } from "./aiRun";

export type RunLabels = { busy: string; done: string; error?: string };

/**
 * What a screen reader hears about a streamed run: one line when it starts and one when it ends, never each token.
 * Without an `error` label a failure says nothing, for views that already announce their error as an alert.
 */
export function runAnnouncement(state: RunState, labels: RunLabels): string {
  if (isBusy(state)) return labels.busy;
  if (state.status === "done") return labels.done;
  if (state.status === "error" && !state.notConnected) return labels.error ?? "";
  return "";
}

/** A visually hidden polite live region. Keep it mounted before the run starts, or the first line may go unread. */
export function RunAnnouncer({ message }: { message: string }): JSX.Element {
  return <div className="sr-only" role="status" aria-live="polite">{message}</div>;
}
