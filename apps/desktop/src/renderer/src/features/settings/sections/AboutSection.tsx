import { Download } from "lucide-react";
import { FlintMark, SettingsRow } from "../../../ui";
import { SectionPage, SelectRow } from "../fields";
import { useSettingsStore } from "../settingsStore";
import styles from "../settings.module.css";

const UPDATE_COPY = {
  restart: "Flint checks every hour and on wake. When a new version finishes downloading, Flint saves your drafts, quits and reopens on the new version right away, even while you're using it.",
  auto: "Flint downloads new versions in the background and installs them the next time you quit. You get a quiet notice, no prompt.",
  ask: "Flint downloads new versions in the background, then asks before restarting. Choosing Later installs on the next quit.",
  manual: "Flint only looks for a new version when you choose Flint > Check for Updates.",
} as const;

/** Keep in step with apps/desktop/package.json. */
export const APP_VERSION = "1.1.0";

export function AboutSection() {
  const { settings, save } = useSettingsStore();
  const mode = settings.updates.mode;
  return (
    <SectionPage title="About">
      <div className={styles.inline} style={{ padding: "var(--s-5) 0" }}>
        <FlintMark size={40} />
        <div>
          <div className="t-title">Flint</div>
          <div className={`${styles.mono} ${styles.muted}`}>Version {APP_VERSION}</div>
        </div>
      </div>
      <SettingsRow title="Free" description="Flint is free. No account, no tracking of you." />
      <SettingsRow title="License" description="MIT. You can read, change and share the source at github.com/neelsatyavolu/flint." />
      <SelectRow
        icon={<Download size={18} strokeWidth={1.5} />}
        title="Updates"
        description={UPDATE_COPY[mode]}
        value={mode}
        choices={[
          { value: "restart", label: "Restart into new versions right away" },
          { value: "auto", label: "Install when I quit" },
          { value: "ask", label: "Ask before restarting" },
          { value: "manual", label: "Only when I check" },
        ]}
        onChange={(v) => void save({ updates: { mode: v } })}
      />
      <SettingsRow title="Your mail stays on this computer" description="Mail is cached in a local database. Flint talks to your mail provider, and to an AI provider only when you use an AI feature." />
    </SectionPage>
  );
}
