import { Kbd, SectionLabel } from "../../../ui";
import { SectionPage } from "../fields";
import { SHORTCUT_GROUPS } from "../shortcutList";
import styles from "../settings.module.css";

export function ShortcutsSection() {
  return (
    <SectionPage title="Shortcuts" description="Single keys work anywhere except in a text field. Press ? in the app to see this list.">
      {SHORTCUT_GROUPS.map((g) => (
        <div key={g.title} className={styles.group}>
          <SectionLabel className={styles.groupLabel}>{g.title}</SectionLabel>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {g.items.map((it) => (
                <tr key={`${it.combo}-${it.label}`} className={styles.hair}>
                  <td style={{ padding: "6px 0" }}>{it.label}</td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}><Kbd combo={it.combo} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </SectionPage>
  );
}
