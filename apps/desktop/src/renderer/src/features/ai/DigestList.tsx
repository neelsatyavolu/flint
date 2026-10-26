import type { JSX } from "react";
import clsx from "clsx";
import { parseDigest } from "./digestParse";
import type { Citation } from "./aiRun";
import styles from "./DigestList.module.css";

type Props = {
  text: string;
  /** Index-aligned with the [n] markers in `text`. Empty while the answer is still streaming. */
  threads: Citation[];
  busy?: boolean;
  /** Show each thread's subject at the right of its row. Off in narrow panels. */
  showSubject?: boolean;
  onOpen: (threadId: number) => void;
};

/** An AI digest as quiet rows in Prose: a titled group of bullets, each one opening the thread it is about. */
export function DigestList({ text, threads, busy = false, showSubject = true, onOpen }: Props): JSX.Element {
  const { groups, notes } = parseDigest(text, threads);
  return (
    <div className={styles.digest}>
      {groups.map((g, gi) => (
        <div key={gi} className={styles.group}>
          {g.title ? <h3 className={clsx("t-label", styles.title)}>{g.title}</h3> : null}
          <ul>
            {g.items.map((item, i) => (
              <li key={i}>
                {item.threadId !== null ? (
                  <button type="button" className={styles.item} onClick={() => onOpen(item.threadId as number)} title={item.subject}>
                    <span className={clsx("t-prose", styles.text)}>{item.text}</span>
                    {showSubject ? <span className={clsx("t-data", styles.ref)}>{item.subject}</span> : null}
                  </button>
                ) : (
                  <div className={clsx(styles.item, styles.plain)}>
                    <span className={clsx("t-prose", styles.text)}>{item.text}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {notes.map((n, i) => <p key={i} className={clsx("t-prose", styles.note)}>{n}</p>)}
      {busy ? <span className={styles.caret} aria-hidden /> : null}
    </div>
  );
}
