import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { Bold, Eraser, Italic, Link2, List, ListOrdered, Quote, Underline } from "lucide-react";
import { IconButton } from "../../../ui/IconButton";
import styles from "./FormatBar.module.css";

type Rect = { top: number; left: number };

function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  return /^(https?:|mailto:)/i.test(v) ? v : v.includes("@") && !v.includes("/") ? `mailto:${v}` : `https://${v}`;
}

/** Quiet toolbar that appears over a text selection. */
export function FormatBar({ editor }: { editor: Editor }): JSX.Element | null {
  const [rect, setRect] = useState<Rect | null>(null);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("");
  const [, force] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  const inBar = (el: EventTarget | null) => el instanceof Node && !!barRef.current?.contains(el);

  useEffect(() => {
    // `related` is where focus is going on blur; activeElement is still <body> then, so the link field opening would close the bar.
    const update = (related: EventTarget | null = null) => {
      const { from, to, empty } = editor.state.selection;
      const focusInBar = inBar(document.activeElement) || inBar(related);
      if (empty || !editor.isFocused && !focusInBar) {
        if (!focusInBar) {
          setRect(null);
          setLinking(false);
        }
        return;
      }
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        setRect({ top: Math.min(start.top, end.top) - 40, left: (start.left + end.right) / 2 });
      } catch {
        setRect(null);
      }
      force((n) => n + 1);
    };
    const sync = () => update();
    const onBlur = ({ event }: { event: FocusEvent }) => update(event.relatedTarget);
    editor.on("selectionUpdate", sync);
    editor.on("focus", sync);
    editor.on("blur", onBlur);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("focus", sync);
      editor.off("blur", onBlur);
    };
  }, [editor]);

  if (!rect) return null;
  const run = (fn: () => void) => () => {
    fn();
    force((n) => n + 1);
  };
  const btn = (label: string, icon: ReactNode, active: boolean, action: () => void) => (
    <IconButton key={label} label={label} size={28} pressed={active} tooltipPlacement="top" onMouseDown={(e) => e.preventDefault()} onClick={run(action)}>
      {icon}
    </IconButton>
  );

  const applyLink = () => {
    const href = normalizeUrl(url);
    const chain = editor.chain().focus();
    if (href) chain.extendMarkRange("link").setLink({ href }).run();
    else chain.extendMarkRange("link").unsetLink().run();
    setLinking(false);
    setUrl("");
  };

  return (
    <div ref={barRef} className={styles.bar} style={{ top: Math.max(8, rect.top), left: rect.left }} role="toolbar" aria-label="Formatting">
      {linking ? (
        <form className={styles.link} onSubmit={(e) => { e.preventDefault(); applyLink(); }}>
          <input
            autoFocus
            className={styles.linkInput}
            value={url}
            placeholder="Paste a link"
            aria-label="Link address"
            onChange={(e) => setUrl(e.target.value)}
            onBlur={(e) => {
              if (inBar(e.relatedTarget)) return;
              setLinking(false);
              if (!(e.relatedTarget instanceof Node && editor.view.dom.contains(e.relatedTarget))) setRect(null);
            }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setLinking(false); editor.commands.focus(); } }}
          />
        </form>
      ) : (
        <>
          {btn("Bold", <Bold size={16} strokeWidth={1.5} />, editor.isActive("bold"), () => editor.chain().focus().toggleBold().run())}
          {btn("Italic", <Italic size={16} strokeWidth={1.5} />, editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run())}
          {btn("Underline", <Underline size={16} strokeWidth={1.5} />, editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run())}
          {btn("Link", <Link2 size={16} strokeWidth={1.5} />, editor.isActive("link"), () => { setUrl((editor.getAttributes("link").href as string | undefined) ?? ""); setLinking(true); })}
          <span className={styles.sep} aria-hidden />
          {btn("Bulleted list", <List size={16} strokeWidth={1.5} />, editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run())}
          {btn("Numbered list", <ListOrdered size={16} strokeWidth={1.5} />, editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run())}
          {btn("Quote", <Quote size={16} strokeWidth={1.5} />, editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run())}
          <span className={styles.sep} aria-hidden />
          {btn("Clear formatting", <Eraser size={16} strokeWidth={1.5} />, false, () => editor.chain().focus().unsetAllMarks().clearNodes().run())}
        </>
      )}
    </div>
  );
}
