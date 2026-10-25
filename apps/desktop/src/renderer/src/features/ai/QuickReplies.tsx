import { useEffect, type JSX } from "react";
import { useSettings } from "../../lib/hooks";
import { useInlineReply } from "../../state/inlineReply";
import { Skeleton } from "../../ui/Skeleton";
import { parseQuickReplies } from "./quickRepliesParse";
import { useAiAvailability, useAiRun } from "./useAiRun";
import styles from "./QuickReplies.module.css";

/** A thread must stay open this long before a model call starts, so skimming with j/k costs nothing. */
export const QUICK_REPLIES_DWELL_MS = 1500;

const cache = new Map<string, string[]>();

type Props = {
  threadId: number;
  cacheKey?: string;
  /** The message the reply answers. With it, picking an option opens the docked reply seeded with the text. */
  messageId?: number;
  onPick?: (text: string) => void;
};

/** Three short reply options for the last message. `cacheKey` must change when the newest message does. Clicking one opens the docked reply with its text. */
export function QuickReplies({ threadId, cacheKey: key, messageId, onPick }: Props): JSX.Element | null {
  const cacheKey = key ?? String(threadId);
  const ai = useAiAvailability();
  const { settings } = useSettings();
  const { state, start, reset } = useAiRun();
  const wanted = ai.ready && settings !== undefined && settings.ai.smartReplies !== false;
  const cached = cache.get(cacheKey);

  useEffect(() => {
    reset();
    if (!wanted || cache.has(cacheKey)) return;
    const timer = setTimeout(() => void start({ kind: "quickReplies", threadId }), QUICK_REPLIES_DWELL_MS);
    return () => clearTimeout(timer);
    // start and reset are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, wanted]);

  const parsed = state.status === "done" ? parseQuickReplies(state.text) : [];
  useEffect(() => {
    if (parsed.length) cache.set(cacheKey, parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.text]);

  const pick = (text: string) => {
    if (messageId !== undefined) useInlineReply.getState().open({ threadId, messageId, mode: "reply", seedText: text });
    onPick?.(text);
  };

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
        <button key={r} type="button" className={styles.chip} title={r} onClick={() => pick(r)}>{r}</button>
      ))}
    </div>
  );
}
