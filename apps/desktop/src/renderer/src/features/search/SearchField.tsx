import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import clsx from "clsx";
import { Input, IconButton } from "../../ui";
import { navStore, useNav } from "../../state/nav";
import { applyHint, searchHints } from "../../state/searchHints";
import styles from "./SearchField.module.css";

export const SEARCH_DEBOUNCE_MS = 150;

/** Search row under the list header. Types are debounced into the nav store; operator hints sit below the field. */
export function SearchField() {
  const stored = useNav((s) => s.search);
  const [text, setText] = useState(stored);
  const [focused, setFocused] = useState(true);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  useEffect(() => {
    if (text === stored) return;
    const t = setTimeout(() => navStore.getState().setSearch(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, stored]);

  const hints = focused ? searchHints(text) : [];
  const clamped = Math.min(active, Math.max(0, hints.length - 1));

  const pick = (i: number) => {
    const hint = hints[i];
    if (!hint) return;
    setText(applyHint(text, hint));
    setActive(0);
    ref.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      navStore.getState().closeSearch();
    } else if (e.key === "ArrowDown" && hints.length) {
      e.preventDefault();
      setActive((clamped + 1) % hints.length);
    } else if (e.key === "ArrowUp" && hints.length) {
      e.preventDefault();
      setActive((clamped - 1 + hints.length) % hints.length);
    } else if (e.key === "Tab" && hints.length && !e.shiftKey) {
      e.preventDefault();
      pick(clamped);
    } else if (e.key === "Enter") {
      if (hints.length && active > 0) {
        e.preventDefault();
        pick(clamped);
      } else {
        navStore.getState().setSearch(text);
      }
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.field}>
        <Search size={14} strokeWidth={1.5} className={styles.icon} />
        <Input
          ref={ref}
          className={styles.input}
          value={text}
          placeholder="Search mail"
          aria-label="Search mail"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={onKeyDown}
        />
        <IconButton className={styles.clear} size={24} label="Close search" shortcut="Escape" onClick={() => navStore.getState().closeSearch()}>
          <X size={14} strokeWidth={1.5} />
        </IconButton>
      </div>
      {hints.length ? (
        <div className={styles.hints} role="listbox" aria-label="Search operators">
          {hints.slice(0, 7).map((h, i) => (
            <button key={h.token} type="button" role="option" aria-selected={i === clamped} className={clsx(styles.hint, i === clamped && styles.hintOn)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
              <span className={clsx("t-data", styles.token)}>{h.token}</span>
              <span className={clsx("t-body", styles.desc)}>{h.description}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
