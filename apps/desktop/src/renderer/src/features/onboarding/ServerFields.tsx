import type { ServerConfig } from "@flint/core";
import { Checkbox, Input } from "../../ui";
import styles from "./onboarding.module.css";

type Props = { server: ServerConfig; onChange: (s: ServerConfig) => void };

const num = (v: string): number => (v.trim() === "" ? 0 : Number(v));

/** IMAP and SMTP host, port and SSL, plus the username. */
export function ServerFields({ server: s, onChange }: Props) {
  const set = (p: Partial<ServerConfig>) => onChange({ ...s, ...p });
  return (
    <div className={styles.step} role="group" aria-label="Server settings">
      <div className={styles.grid3}>
        <label className={styles.field}><span className={`t-label ${styles.label}`}>IMAP server</span><Input value={s.imapHost} spellCheck={false} onChange={(e) => set({ imapHost: e.target.value })} /></label>
        <label className={styles.field}><span className={`t-label ${styles.label}`}>Port</span><Input inputMode="numeric" aria-label="IMAP port" value={s.imapPort || ""} onChange={(e) => set({ imapPort: num(e.target.value) })} /></label>
        <Checkbox label={<>SSL<span className="sr-only"> for IMAP</span></>} checked={s.imapSecure} onChange={(v) => set({ imapSecure: v })} />
      </div>
      <div className={styles.grid3}>
        <label className={styles.field}><span className={`t-label ${styles.label}`}>SMTP server</span><Input value={s.smtpHost} spellCheck={false} onChange={(e) => set({ smtpHost: e.target.value })} /></label>
        <label className={styles.field}><span className={`t-label ${styles.label}`}>Port</span><Input inputMode="numeric" aria-label="SMTP port" value={s.smtpPort || ""} onChange={(e) => set({ smtpPort: num(e.target.value) })} /></label>
        <Checkbox label={<>SSL<span className="sr-only"> for SMTP</span></>} checked={s.smtpSecure} onChange={(v) => set({ smtpSecure: v })} />
      </div>
      <label className={styles.field}><span className={`t-label ${styles.label}`}>Username</span><Input value={s.username} spellCheck={false} placeholder="Usually your email address" onChange={(e) => set({ username: e.target.value })} /></label>
    </div>
  );
}
