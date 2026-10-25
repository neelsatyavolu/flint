import { useState, type JSX, type RefObject } from "react";
import { Sparkles, X } from "lucide-react";
import type { AiTask } from "@flint/core";
import type { BodyEditorHandle, BodySnapshot } from "../compose/editor/BodyEditor";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { Menu } from "../../ui/Menu";
import { isBusy } from "./aiRun";
import {
  LANGUAGES, REWRITE_CHIPS, taskForPrompt, taskForReply, taskForStyle, taskForTranslate, type BarContext,
} from "./aiBarTasks";
import { NotConnected } from "./NotConnected";
import { ProseText } from "./ProseText";
import { useAiAvailability, useAiRun } from "./useAiRun";
import styles from "./AiBar.module.css";

type Props = { body: RefObject<BodyEditorHandle | null>; threadId: number | null; draftId: number; onClose: () => void };

const NEEDS_TEXT = "Write something or select text first.";

/** The +AI prompt bar under the composer toolbar. Streams into a preview; the user inserts, replaces or discards. */
export function AiBar({ body, threadId, draftId, onClose }: Props): JSX.Element {
  const ai = useAiAvailability();
  const { state, start, cancel, reset } = useAiRun();
  const [prompt, setPrompt] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [snap, setSnap] = useState<BodySnapshot | null>(null);
  const [last, setLast] = useState<AiTask | null>(null);

  const run = (build: (ctx: BarContext) => AiTask | null) => {
    const snapshot = body.current?.snapshot() ?? { text: "", from: 0, to: 0, scope: "body" as const };
    const task = build({ threadId, draftId, text: snapshot.text });
    if (!task) {
      setHint(NEEDS_TEXT);
      return;
    }
    setHint(null);
    setSnap(snapshot);
    setLast(task);
    void start(task);
  };

  const close = () => {
    cancel();
    onClose();
  };
  const done = state.status === "done" && state.text.trim() !== "";
  const busy = isBusy(state);
  const canReplace = snap !== null && snap.text.trim() !== "";
  const discard = () => {
    reset();
    setHint(null);
  };

  if (!ai.loading && !ai.ready) {
    return (
      <div className={styles.bar} aria-label="+AI">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <NotConnected compact />
          <IconButton label="Close +AI" size={24} onClick={onClose}><X size={14} strokeWidth={1.5} /></IconButton>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.bar} aria-label="+AI">
      <form className={styles.prompt} onSubmit={(e) => { e.preventDefault(); run((c) => taskForPrompt(prompt, c)); }}>
        <Sparkles size={16} strokeWidth={1.5} aria-hidden />
        <input
          className={styles.input}
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }}
          placeholder="Tell +AI what to write or change"
          aria-label="+AI prompt"
          spellCheck={false}
        />
        <IconButton label="Close +AI" size={24} onClick={close}><X size={14} strokeWidth={1.5} /></IconButton>
      </form>
      <div className={styles.chips} role="group" aria-label="Suggestions">
        <button type="button" className={styles.chip} disabled={busy} onClick={() => run((c) => taskForReply(c, prompt))}>
          {threadId !== null ? "Write a reply" : "Write a draft"}
        </button>
        {REWRITE_CHIPS.map((c) => (
          <button key={c.id} type="button" className={styles.chip} disabled={busy} onClick={() => run((ctx) => taskForStyle(c.id, ctx))}>{c.label}</button>
        ))}
        <Menu
          placement="bottom-start"
          items={LANGUAGES.map((l) => ({ id: l, label: l, onSelect: () => run((ctx) => taskForTranslate(l, ctx)) }))}
          trigger={<button type="button" className={styles.chip} disabled={busy}>Translate…</button>}
        />
      </div>
      {hint ? <div className={`t-data ${styles.hint}`} role="status">{hint}</div> : null}
      {state.notConnected ? <div style={{ paddingLeft: 24 }}><NotConnected compact /></div> : null}
      {state.status === "error" && !state.notConnected ? <div className={`t-body ${styles.err}`} role="alert">{state.error}</div> : null}
      {busy || done ? (
        <div className={styles.preview} aria-live="polite">
          {state.text ? (
            <div className={styles.previewText}>
              <ProseText text={state.text} />
              {busy ? <span className={styles.caret} aria-hidden /> : null}
            </div>
          ) : (
            <span className={`t-data ${styles.hint}`} style={{ padding: 0 }}>{state.note || "Thinking"}</span>
          )}
          <div className={styles.actions}>
            {busy ? (
              <Button size="sm" variant="ghost" onClick={cancel}>Stop</Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => { body.current?.insert(state.text); discard(); }}>Insert</Button>
                {canReplace ? (
                  <Button size="sm" variant="ghost" onClick={() => { if (snap) body.current?.replace(snap, state.text); discard(); }}>Replace</Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>
                <Button size="sm" variant="ghost" onClick={() => last && void start(last)}>Try again</Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
