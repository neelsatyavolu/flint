import { useEffect, useState, type JSX } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useSettings } from "../../lib/hooks";
import { readStored, writeStored } from "../../lib/storage";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { ProseText } from "./ProseText";
import { useAiAvailability, useAiRun } from "./useAiRun";
import { isBusy } from "./aiRun";
import styles from "./ThreadSummary.module.css";

type Props = { threadId: number; messageCount: number; wordCount: number };

const COLLAPSED_KEY = "flint.summary.collapsed";
const cache = new Map<string, string>();

/** A summary is worth showing on long threads only. */
export const needsSummary = (messageCount: number, wordCount: number): boolean => messageCount >= 3 || wordCount >= 300;

/** Streams and shows the thread summary. The backend caches by thread and latest message; this cache just spares a re-stream while navigating. */
export function ThreadSummary({ threadId, messageCount, wordCount }: Props): JSX.Element | null {
  const ai = useAiAvailability();
  const { settings } = useSettings();
  const { state, start, reset } = useAiRun();
  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSED_KEY) === "1");
  const cacheKey = `${threadId}:${messageCount}`;
  const [cached, setCached] = useState<string | undefined>(() => cache.get(cacheKey));

  const wanted = needsSummary(messageCount, wordCount) && ai.ready && settings?.ai.autoSummarize !== false && settings !== undefined;

  useEffect(() => {
    const hit = cache.get(cacheKey);
    setCached(hit);
    reset();
    if (wanted && !hit) void start({ kind: "summarize", threadId });
    // start and reset are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, wanted]);

  useEffect(() => {
    if (state.status === "done" && state.text.trim()) {
      cache.set(cacheKey, state.text);
      setCached(state.text);
    }
  }, [state.status, state.text, cacheKey]);

  if (!wanted) return null;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeStored(COLLAPSED_KEY, next ? "1" : "0");
  };
  const text = cached ?? state.text;
  const busy = isBusy(state);
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <section className={styles.summary} aria-label="Thread summary">
      <div className={styles.head}>
        <button type="button" onClick={toggle} aria-expanded={!collapsed}>
          <Chevron size={12} strokeWidth={1.5} aria-hidden />
          <span className="t-label">Summary</span>
        </button>
        {busy && state.note ? <span className={`t-data ${styles.note}`}>{state.note}</span> : null}
      </div>
      {collapsed ? null : state.status === "error" && !cached ? (
        <div className={`t-body ${styles.error}`}>
          <span>Couldn't summarize this thread.</span>
          <Button size="sm" variant="ghost" onClick={() => void start({ kind: "summarize", threadId })}>Try again</Button>
        </div>
      ) : text ? (
        <div className={styles.text}>
          <ProseText text={text} />
          {busy ? <span className={styles.caret} aria-hidden /> : null}
        </div>
      ) : (
        <div className={styles.lines} aria-busy="true">
          <Skeleton height={14} width="92%" />
          <Skeleton height={14} width="78%" />
        </div>
      )}
    </section>
  );
}
