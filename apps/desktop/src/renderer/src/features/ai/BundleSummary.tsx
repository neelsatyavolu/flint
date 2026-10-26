import { useEffect, useRef, useState, type JSX } from "react";
import { Sparkles } from "lucide-react";
import { IconButton } from "../../ui/IconButton";
import { Popover } from "../../ui/Popover";
import { Skeleton } from "../../ui/Skeleton";
import { Button } from "../../ui/Button";
import { navStore } from "../../state/nav";
import { CATEGORY_TITLES } from "../../state/viewMeta";
import { isBusy } from "./aiRun";
import { DigestList } from "./DigestList";
import { RunAnnouncer, runAnnouncement } from "./RunAnnouncer";
import { useAiAvailability, useAiRun } from "./useAiRun";
import styles from "./BundleSummary.module.css";

type BundleCategory = "notifications" | "newsletters";

/** Bundles only: the people category is never summarized this way. */
export const isBundleCategory = (c: string | undefined): c is BundleCategory => c === "notifications" || c === "newsletters";

/**
 * One-click summary of a Notifications or Newsletters bundle, for the bundle's list header.
 * Opens a panel that streams a few bullets, each linking to its thread. Hidden when AI is off or not connected.
 */
export function BundleSummary({ category }: { category: BundleCategory }): JSX.Element | null {
  const ai = useAiAvailability();
  const { state, start, reset } = useAiRun();
  const [open, setOpen] = useState(false);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    asked.current = null;
    reset();
    setOpen(false);
    // reset is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  if (!ai.ready) return null;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && asked.current !== category) {
      asked.current = category;
      void start({ kind: "summarizeBundle", category });
    }
  };
  const refresh = () => {
    asked.current = category;
    void start({ kind: "summarizeBundle", category });
  };
  const title = CATEGORY_TITLES[category];
  const busy = isBusy(state);

  return (
    <>
    {/* Outside the popover, so the live region already exists when the run starts as the popover opens. */}
    <RunAnnouncer message={runAnnouncement(state, { busy: `Summarizing ${title}`, done: `${title} summary ready`, error: `Couldn't summarize ${title}` })} />
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      placement="bottom-end"
      className={styles.panel}
      label={`${title} summary`}
      trigger={<IconButton label={`Summarize ${title}`} tone="accent" className="no-drag"><Sparkles size={16} strokeWidth={1.5} /></IconButton>}
    >
      {(close) => (
        <div className={styles.body}>
          <div className={styles.head}>
            <span className="t-label">{title} · summary</span>
            <span className={`t-data ${styles.tag}`}>+AI</span>
          </div>
          {state.status === "error" ? (
            <div className={`t-body ${styles.error}`}>
              <span>{state.notConnected ? "Connect ChatGPT or Grok in Settings to use this." : "Couldn't summarize this bundle."}</span>
              {state.notConnected ? null : <Button size="sm" variant="ghost" onClick={refresh}>Try again</Button>}
            </div>
          ) : state.text ? (
            <DigestList
              text={state.text}
              threads={state.citations}
              busy={busy}
              showSubject={false}
              onOpen={(id) => { close(); navStore.getState().openThread(id); }}
            />
          ) : (
            <div className={styles.lines} aria-busy="true">
              <Skeleton height={14} width="92%" />
              <Skeleton height={14} width="80%" />
              <Skeleton height={14} width="60%" />
            </div>
          )}
          {state.status === "done" ? (
            <div className={styles.foot}><Button size="sm" variant="ghost" onClick={refresh}>Summarize again</Button></div>
          ) : null}
        </div>
      )}
    </Popover>
    </>
  );
}
