import type { JSX } from "react";
import { X } from "lucide-react";
import { IconButton } from "../../ui/IconButton";
import { Composer } from "./Composer";
import { closeComposer, restoreComposer, useComposers } from "./composerStore";
import styles from "./Composer.module.css";

/**
 * Mount once in the app shell. The open composer covers everything right of the sidebar
 * (its left edge is the CSS variable --flint-sidebar-width, default 232px). Minimized drafts
 * sit as chips at the bottom-right. Every composer stays mounted so the editor keeps its state.
 */
export function ComposerHost(): JSX.Element | null {
  const composers = useComposers();
  if (composers.length === 0) return null;
  const minimized = composers.filter((c) => c.minimized);
  return (
    <>
      <div className={styles.host}>
        {composers.map((c) => (
          <div key={c.id} className={styles.panelSlot} hidden={c.minimized}>
            <Composer entry={c} hidden={c.minimized} />
          </div>
        ))}
      </div>
      {minimized.length ? (
        <div className={styles.chips} role="list" aria-label="Minimized drafts">
          {minimized.map((c) => (
            <div key={c.id} className={styles.chip} role="listitem">
              <button type="button" className={styles.chipOpen} onClick={() => restoreComposer(c.id)} aria-label={`Open draft: ${c.label ?? "New message"}`}>
                <span>{c.label ?? "New message"}</span>
              </button>
              <IconButton label="Close draft" size={24} onClick={() => closeComposer(c.id)}><X size={14} strokeWidth={1.5} /></IconButton>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
