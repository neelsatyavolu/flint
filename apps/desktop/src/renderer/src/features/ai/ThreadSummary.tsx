import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useSettings } from "../../lib/hooks";
import { readStored, writeStored } from "../../lib/storage";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { ProseText } from "./ProseText";
import { RunAnnouncer, runAnnouncement } from "./RunAnnouncer";
import { ThreadTranslate } from "./ThreadTranslate";
import { useAiAvailability, useAiRun } from "./useAiRun";
import { isBusy } from "./aiRun";
import styles from "./ThreadSummary.module.css";

type Props = { threadId: number; messageCount: number; wordCount: number };

const COLLAPSED_KEY = "flint.summary.collapsed";
const cache = new Map<string, string>();
/** Whether summaries were on the last time we knew. A new thread reserves the summary's space from this while availability reloads. */
let lastWanted = false;
/** Height of the last summary that was shown. Real summaries run taller than a two-line placeholder, so the placeholder reserves this much and the text lands without moving the thread. */
let lastTextHeight = 150;
const clampHeight = (px: number): number => Math.min(Math.max(Math.round(px), 72), 260);
/** One placeholder bar plus the gap under it. The placeholder fills the space it reserves with bars, so it reads as text on the way rather than an empty box. */
const BAR_STEP_PX = 22;
const BAR_WIDTHS = ["92%", "84%", "66%", "88%", "52%", "76%", "60%", "82%", "48%", "70%", "58%", "40%"];
const barWidths = (height: number): string[] => BAR_WIDTHS.slice(0, Math.max(2, Math.floor((height + 8) / BAR_STEP_PX)));

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
  /** Known before the summary is written, so only one that arrives while the thread is open fades in. */
  const openedWithSummary = useMemo(() => cache.has(cacheKey), [cacheKey]);

  const resolved = !ai.loading && settings !== undefined;
  const enabled = resolved ? ai.ready && settings?.ai.autoSummarize !== false : lastWanted;
  const wanted = needsSummary(messageCount, wordCount) && enabled;
  useEffect(() => {
    if (resolved) lastWanted = ai.ready && settings?.ai.autoSummarize !== false;
  }, [resolved, ai.ready, settings?.ai.autoSummarize]);

  useEffect(() => {
    const hit = cache.get(cacheKey);
    setCached(hit);
    reset();
    if (wanted && resolved && !hit) void start({ kind: "summarize", threadId });
    // start and reset are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, wanted, resolved]);

  useEffect(() => {
    if (state.status === "done" && state.text.trim()) {
      cache.set(cacheKey, state.text);
      setCached(state.text);
    }
  }, [state.status, state.text, cacheKey]);

  const textRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const h = textRef.current?.firstElementChild instanceof HTMLElement ? textRef.current.firstElementChild.offsetHeight : 0;
    if (h > 0) lastTextHeight = clampHeight(h);
  });

  const translate = ai.ready ? <ThreadTranslate threadId={threadId} /> : null;
  if (!wanted) return translate;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeStored(COLLAPSED_KEY, next ? "1" : "0");
  };
  const busy = isBusy(state);
  // The summary appears whole once it is written. Streaming it line by line would push the messages down every few frames.
  const text = cached ?? (busy ? "" : state.text);
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <>
    <section className={styles.summary} aria-label="Thread summary">
      <RunAnnouncer message={runAnnouncement(state, { busy: "Summarizing this thread", done: "Summary ready", error: "Couldn't summarize this thread" })} />
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
        <div className={`${styles.text} ${openedWithSummary ? "" : styles.arrive}`} ref={textRef} style={{ minHeight: lastTextHeight }}>
          <ProseText text={text} />
        </div>
      ) : (
        <div className={styles.lines} aria-busy="true" style={{ minHeight: lastTextHeight }}>
          {barWidths(lastTextHeight).map((w, i) => <Skeleton key={i} height={14} width={w} />)}
        </div>
      )}
    </section>
    {translate}
    </>
  );
}
