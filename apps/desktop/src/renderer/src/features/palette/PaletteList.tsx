import { Fragment, type JSX } from "react";
import { Check, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { Kbd } from "../../ui";
import type { Range } from "./fuzzy";
import type { Row } from "./model";
import type { Section } from "./sections";
import styles from "./CommandPalette.module.css";

/** Label with the matched characters marked. */
export function Highlight({ text, ranges }: { text: string; ranges: Range[] }): JSX.Element {
  if (ranges.length === 0) return <>{text}</>;
  const parts: JSX.Element[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, s)}</Fragment>);
    parts.push(<mark key={`m${i}`} className={styles.mark}>{text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < text.length) parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}

type Props = {
  sections: Section[];
  activeId: string | undefined;
  idPrefix: string;
  onHover: (id: string) => void;
  onPick: (row: Row) => void;
};

export const optionId = (prefix: string, rowId: string) => `${prefix}-${rowId.replace(/[^\w-]/g, "_")}`;

/** Grouped options with small section headers. Rows are not focusable: the input keeps focus and points at the active one. */
export function PaletteList({ sections, activeId, idPrefix, onHover, onPick }: Props): JSX.Element {
  return (
    <>
      {sections.map((s) => (
        <div key={s.id} role="group" aria-labelledby={s.title ? `${idPrefix}-h-${s.id}` : undefined} aria-label={s.title ? undefined : "Options"}>
          {s.title ? (
            <div id={`${idPrefix}-h-${s.id}`} className={clsx("t-label", styles.head)}>
              <span>{s.title}</span>
              {s.meta ? <span>{s.meta}</span> : null}
            </div>
          ) : null}
          {s.rows.map((row) => {
            const on = row.id === activeId;
            return (
              <div
                key={row.id}
                id={optionId(idPrefix, row.id)}
                role="option"
                aria-selected={on}
                data-active={on}
                className={clsx("t-body", styles.row, on && styles.rowOn)}
                onMouseMove={() => { if (!on) onHover(row.id); }}
                onClick={() => onPick(row)}
              >
                <span className={styles.icon} aria-hidden>{row.icon}</span>
                <span className={styles.text}>
                  <span className={clsx(styles.label, row.bold && styles.bold)}><Highlight text={row.label} ranges={row.ranges} /></span>
                  {row.detail ? <span className={clsx("t-body", styles.detail)}>{row.detail}</span> : null}
                </span>
                <span className={styles.tail}>
                  {row.hint ? <span className={clsx("t-data", styles.hint)}>{row.hint}</span> : null}
                  {row.shortcut ? <Kbd combo={row.shortcut} /> : null}
                  {row.checked ? <Check size={14} strokeWidth={1.5} aria-label="Current" /> : null}
                  {row.page ? <ChevronRight size={14} strokeWidth={1.5} aria-hidden /> : null}
                </span>
              </div>
            );
          })}
          {s.status ? (
            <div className={clsx("t-body", styles.status, s.status.kind === "error" && styles.error)}>
              <span className={s.status.kind === "loading" ? styles.dots : undefined}>{s.status.text}</span>
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}
