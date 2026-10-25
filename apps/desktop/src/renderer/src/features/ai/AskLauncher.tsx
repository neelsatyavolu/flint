import { useEffect, useState, type JSX } from "react";
import { Sparkles } from "lucide-react";
import { useComposers } from "../compose/composerStore";
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
  const covered = composers.some((c) => !c.minimized);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question;
      setOpen(true);
      if (q) void ask(q);
    };
    window.addEventListener(OPEN_ASK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ASK_EVENT, onOpen);
  }, [ask]);

  if (open) return <AskPanel conversation={conversation} onClose={() => setOpen(false)} />;
  if (covered) return null;

  return (
    <form
      className={styles.launcher}
      style={{ bottom: 16 + (minimized ? minimized * 36 + 8 : 0) }}
      onSubmit={(e) => {
        e.preventDefault();
        setOpen(true);
        if (text.trim()) void conversation.ask(text);
        setText("");
      }}
    >
      <Sparkles size={16} strokeWidth={1.5} aria-hidden />
      <input className={styles.field} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask anything" aria-label="Ask anything" spellCheck={false} />
    </form>
  );
}
