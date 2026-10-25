import { Dialog, Kbd, SectionLabel } from "../../ui";
import { navStore } from "../../state/nav";
import { SHORTCUT_GROUPS } from "./shortcutTable";
import styles from "./Palette.module.css";

export function ShortcutSheet() {
  return (
    <Dialog open onClose={() => navStore.getState().closeOverlay()} title="Keyboard shortcuts" width={680}>
      <div className={styles.sheet}>
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title} className={styles.sheetGroup}>
            <SectionLabel>{g.title}</SectionLabel>
            <dl>
              {g.entries.map((e) => (
                <div key={e.combo} className={styles.sheetRow}>
                  <dt>{e.label}</dt>
                  <dd><Kbd combo={e.combo} /></dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
