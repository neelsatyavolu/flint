import { useEffect, useState, type JSX } from "react";
import { Sparkles } from "lucide-react";
import { Button, SectionLabel, Skeleton } from "../../ui";
import { navStore } from "../../state/nav";
import { isBusy, type Citation } from "../ai/aiRun";
import { DigestList } from "../ai/DigestList";
import { useAiAvailability, useAiRun } from "../ai/useAiRun";
import styles from "./HomeView.module.css";

const FRESH_MS = 30 * 60 * 1000;
type Saved = { text: string; threads: Citation[]; at: number };
let saved: Saved | null = null;

/** A streamed digest of unread people mail and what needs a reply. Runs only when asked; hidden when +AI is off. */
export function CatchMeUp(): JSX.Element | null {
  const ai = useAiAvailability();
  const { state, start } = useAiRun();
  const [kept, setKept] = useState<Saved | null>(() => (saved && Date.now() - saved.at < FRESH_MS ? saved : null));

  useEffect(() => {
    if (state.status === "done" && state.text.trim()) {
      saved = { text: state.text, threads: state.citations, at: Date.now() };
      setKept(saved);
    }
  }, [state.status, state.text, state.citations]);

  if (!ai.ready) return null;
  const busy = isBusy(state);
  const ask = () => void start({ kind: "digest" });
  const text = busy || state.status === "error" ? state.text : (state.text || kept?.text || "");
  const threads = state.text ? state.citations : (kept?.threads ?? []);

  return (
    <section className={styles.block} aria-label="Catch me up">
      <div className={styles.blockHead}>
        <SectionLabel className={styles.blockLabel}>Catch me up</SectionLabel>
        <span className={`t-data ${styles.tag}`}>+AI</span>
      </div>
      {text ? (
        <>
          <DigestList text={text} threads={threads} busy={busy} onOpen={(id) => navStore.getState().openThread(id, { fromOutside: true })} />
          {!busy ? (
            <div className={styles.aiFoot}>
              <Button size="sm" variant="ghost" onClick={ask}>Catch me up again</Button>
            </div>
          ) : null}
        </>
      ) : busy ? (
        <div className={styles.aiLines} aria-busy="true">
          <Skeleton height={14} width="90%" /><Skeleton height={14} width="75%" />
          {state.note ? <span className={`t-data ${styles.aiNote}`}>{state.note}</span> : null}
        </div>
      ) : (
        <div className={styles.aiAsk}>
          <p className={`t-body ${styles.aiHint}`}>
            {state.status === "error" ? (state.notConnected ? "Connect ChatGPT or Grok in Settings to use this." : "Couldn't catch you up. Try again.") : "A short read of your unread mail from people, and what needs a reply."}
          </p>
          <Button size="sm" variant="ghost" onClick={ask}><Sparkles size={14} strokeWidth={1.5} aria-hidden />Catch me up</Button>
        </div>
      )}
    </section>
  );
}
