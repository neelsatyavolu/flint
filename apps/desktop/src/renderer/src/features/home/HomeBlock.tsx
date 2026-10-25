import type { ReactNode } from "react";
import { SectionLabel } from "../../ui";
import styles from "./HomeView.module.css";

/** A titled quiet list on Home. `tag` marks AI-made blocks (+AI) at the right of the title. */
export function HomeBlock({ title, tag, children }: { title: string; tag?: string; children: ReactNode }) {
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <SectionLabel className={styles.blockLabel}>{title}</SectionLabel>
        {tag ? <span className={`t-data ${styles.tag}`}>{tag}</span> : null}
      </div>
      <ul>{children}</ul>
    </section>
  );
}
