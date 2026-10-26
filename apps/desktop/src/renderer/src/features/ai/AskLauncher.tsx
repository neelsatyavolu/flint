import { useEffect, useState, type JSX } from "react";
import { Sparkles } from "lucide-react";
import { useComposers } from "../compose/composerStore";
import { useInlineReply } from "../../state/inlineReply";
import { AskPanel } from "./AskPanel";
import { OPEN_ASK_EVENT } from "./events";
import { useAsk } from "./useAsk";
import styles from "./Ask.module.css";

/** Floating "Ask anything" field bottom-right. Enter opens the Ask panel and sends the question. */
export function AskLauncher(): JSX.Element | null {
  const conversation = useAsk();
  const { ask } = conversation;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const composers = useComposers();
  const minimized = composers.filter((c) => c.minimized).length;
  // A full composer or the docked inline reply owns the bottom of the window.
  const replying = useInlineReply((s) => s.request !== null);
  const covered = replying || composers.some((c) => !c.minimized);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question;
      setOpen(true);
      if (q) void ask(q);
    };
    window.addEventListener(OPEN_ASK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ASK_EVENT, onOpen);
  }, [ask]);

  // The reader keeps this much room at the bottom so the field never covers its last lines.
  useEffect(() => {
    const root = document.documentElement.style;
    const chips = minimized ? minimized * 36 + 8 : 0;
    // While the reply is docked the field is hidden, so no room is kept for it.
    root.setProperty("--ask-clearance", `${replying ? chips : 16 + 40 + 16 + chips}px`);
    return () => { root.removeProperty("--ask-clearance"); };
  }, [minimized, replying]);

  const bottom = 16 + (minimized ? minimized * 36 + 8 : 0);
  if (open) return <AskPanel conversation={conversation} onClose={() => setOpen(false)} bottom={bottom} />;
  if (covered) return null;

  return (
    <form
      className={styles.launcher}
      style={{ bottom }}
      onSubmit={(e) => {
        e.preventDefault();
        setOpen(true);
        if (text.trim()) void conversation.ask(text);
        setText("");
      }}
    >
      <Sparkles size={16} strokeWidth={1.5} aria-hidden />
      <input className={styles.field} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }} placeholder="Ask anything" aria-label="Ask anything" spellCheck={false} />
    </form>
  );
}
