import { useEffect, type JSX } from "react";
import { useSettings } from "../../lib/hooks";
import { Skeleton } from "../../ui/Skeleton";
import { parseQuickReplies } from "./quickRepliesParse";
import { useAiAvailability, useAiRun } from "./useAiRun";
import styles from "./QuickReplies.module.css";

const cache = new Map<string, string[]>();

/** Three short reply options for the last message. Clicking one hands its text to onPick. */
export function QuickReplies({ threadId, onPick }: { threadId: number; onPick: (text: string) => void }): JSX.Element | null {
  const ai = useAiAvailability();
  const { settings } = useSettings();
  const { state, start, reset } = useAiRun();
  const wanted = ai.ready && settings !== undefined && settings.ai.smartReplies !== false;
  const cached = cache.get(String(threadId));

  useEffect(() => {
    reset();
    if (wanted && !cache.has(String(threadId))) void start({ kind: "quickReplies", threadId });
    // start and reset are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, wanted]);

  const parsed = state.status === "done" ? parseQuickReplies(state.text) : [];
  useEffect(() => {
    if (parsed.length) cache.set(String(threadId), parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.text]);

  if (!wanted || state.status === "error") return null;
  const replies = cached ?? parsed;
  if (replies.length === 0) {
    return state.status === "done" ? null : (
      <div className={styles.row} aria-busy="true" aria-label="Loading quick replies">
        <Skeleton width={120} height={28} />
        <Skeleton width={120} height={28} />
        <Skeleton width={120} height={28} />
      </div>
    );
  }
  return (
    <div className={styles.row} role="group" aria-label="Quick replies">
      {replies.map((r) => (
        <button key={r} type="button" className={styles.chip} title={r} onClick={() => onPick(r)}>{r}</button>
      ))}
    </div>
  );
}
