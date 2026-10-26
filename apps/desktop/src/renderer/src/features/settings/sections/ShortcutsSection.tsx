import { useState } from "react";
import { Keyboard } from "lucide-react";
import { Kbd, SectionLabel } from "../../../ui";
import { setSingleKeyShortcuts, singleKeyShortcutsOn } from "../../../shell/useGlobalShortcuts";
import { SHORTCUT_GROUPS } from "../../palette/shortcutTable";
import { SectionPage, ToggleRow } from "../fields";
import styles from "../settings.module.css";

export function ShortcutsSection() {
  const [singleKey, setSingleKey] = useState(singleKeyShortcutsOn);
  return (
    <SectionPage title="Shortcuts" description="Single keys work anywhere except in a text field. Press ? in the app to see this list.">
      <ToggleRow
        icon={<Keyboard size={18} strokeWidth={1.5} />}
        title="Single-key shortcuts"
        description="Keys like E, # and J act on mail without a modifier. Turn this off if you use speech input or press keys by accident; shortcuts with ⌘ keep working. Saved on this computer."
        checked={singleKey}
        onChange={(on) => {
          setSingleKeyShortcuts(on);
          setSingleKey(on);
        }}
      />
      {SHORTCUT_GROUPS.map((g) => (
        <div key={g.title} className={styles.group}>
          <SectionLabel className={styles.groupLabel}>{g.title}</SectionLabel>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {g.entries.map((it) => (
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
