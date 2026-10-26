import { useEffect, useRef, useState, type JSX } from "react";
import { ArrowUp, FileText, Sparkles, Square, X } from "lucide-react";
import { IconButton } from "../../ui/IconButton";
import { isBusy } from "./aiRun";
import { openThread } from "./events";
import { NotConnected } from "./NotConnected";
import { ProseText } from "./ProseText";
import { RunAnnouncer, runAnnouncement } from "./RunAnnouncer";
import type { useAsk } from "./useAsk";
import styles from "./Ask.module.css";

type Props = { conversation: ReturnType<typeof useAsk>; onClose: () => void; /** Distance from the window's bottom edge, as for the Ask field. */ bottom?: number };

/** A floating panel bottom-right, in place of the Ask field: questions in UI type, answers in Prose, cited threads as rows. */
export function AskPanel({ conversation, onClose, bottom = 16 }: Props): JSX.Element {
  const { turns, ask, stop } = conversation;
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const lastRef = useRef<HTMLElement>(null);
  const awaiting = useRef<number | null>(null);
  const busy = turns.some((t) => isBusy(t.run));
  const last = turns.at(-1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // When the answer to a question asked here finishes, move focus to it so a screen reader reads it,
  // unless the user has already moved on to something outside the panel.
  useEffect(() => {
    if (!last) return;
    if (isBusy(last.run)) {
      awaiting.current = last.id;
      return;
    }
    if (awaiting.current !== last.id) return;
    awaiting.current = null;
    const focused = document.activeElement;
    const inPanel = !focused || focused === document.body || panelRef.current?.contains(focused);
    if (last.run.status === "done" && inPanel) lastRef.current?.focus({ preventScroll: true });
  }, [last]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("[role=menu],[role=dialog]")) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const submit = () => {
    if (!text.trim() || busy) return;
    void ask(text);
    setText("");
  };

  return (
    <aside ref={panelRef} className={styles.panel} style={{ bottom }} aria-label="Ask">
      <RunAnnouncer message={last ? runAnnouncement(last.run, { busy: "Answering", done: "Answer ready" }) : ""} />
      <header className={styles.head}>
        <span className={`t-title ${styles.title}`}><Sparkles size={16} strokeWidth={1.5} aria-hidden />Ask</span>
        <IconButton label="Close" shortcut="Escape" onClick={onClose}><X size={16} strokeWidth={1.5} /></IconButton>
      </header>
      <div ref={scrollRef} className={styles.scroll}>
        {turns.length === 0 ? <p className={`t-body ${styles.empty}`}>Ask about anything in your mail. Answers cite the threads they came from.</p> : null}
        {turns.map((t) => (
          <section key={t.id} ref={t.id === last?.id ? lastRef : undefined} tabIndex={-1} className={styles.turn}>
            <p className={styles.q}>{t.question}</p>
            {t.run.notConnected ? (
              <NotConnected />
            ) : t.run.status === "error" ? (
              <p className="t-body" role="alert" style={{ color: "var(--danger)" }}>{t.run.error}</p>
            ) : (
              <>
                {t.run.text ? (
                  <div>
                    <ProseText text={t.run.text} />
                    {isBusy(t.run) ? <span className={styles.caret} aria-hidden /> : null}
                  </div>
                ) : (
                  <span className={`t-data ${styles.note}`}>{t.run.note || "Thinking"}</span>
                )}
                {t.run.citations.length ? (
                  <div className={styles.cites} aria-label="Threads used">
                    {t.run.citations.map((c) => (
                      <button key={c.threadId} type="button" className={styles.cite} onClick={() => openThread(c.threadId)}>
                        <FileText size={14} strokeWidth={1.5} aria-hidden />
                        <span>{c.subject}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </section>
        ))}
      </div>
      <form className={styles.foot} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input
          ref={inputRef}
          className={styles.field}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={last ? "Ask a follow-up" : "Ask anything"}
          aria-label="Question"
          spellCheck={false}
        />
        {busy ? (
          <IconButton label="Stop" onClick={stop}><Square size={14} strokeWidth={1.5} /></IconButton>
        ) : (
          <IconButton label="Ask" type="submit" tone="accent" disabled={!text.trim()}><ArrowUp size={16} strokeWidth={1.5} /></IconButton>
        )}
      </form>
    </aside>
  );
}
