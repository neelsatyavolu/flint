import { FlintMark, SettingsRow } from "../../../ui";
import { SectionPage } from "../fields";
import styles from "../settings.module.css";

/** Keep in step with apps/desktop/package.json. */
export const APP_VERSION = "0.1.0";

export function AboutSection() {
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
      <SettingsRow title="License" description="MIT. You can read, change and share the source." />
      <SettingsRow title="Your mail stays on this computer" description="Mail is cached in a local database. Flint talks to your mail provider, and to an AI provider only when you use an AI feature." />
    </SectionPage>
  );
}
