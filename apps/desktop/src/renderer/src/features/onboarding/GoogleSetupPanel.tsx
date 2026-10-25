import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { flint } from "../../lib/api";
import { openExternal } from "../../lib/host";
import { Button, Input } from "../../ui";
import { CONSOLE_URL, GOOGLE_STEPS, checkClient } from "./googleSetup";
import styles from "./onboarding.module.css";

/** Walks the user through creating a free Desktop OAuth client and saves it to settings.google. */
export function GoogleSetupPanel({ initialId = "", initialSecret = "", onSaved }: { initialId?: string; initialSecret?: string; onSaved: () => void }) {
  const [clientId, setClientId] = useState(initialId);
  const [clientSecret, setClientSecret] = useState(initialSecret);
  const [errors, setErrors] = useState<{ clientId?: string; clientSecret?: string; save?: string }>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const c = checkClient(clientId, clientSecret);
    if (!c.ok) return setErrors(c.errors);
    setErrors({});
    setBusy(true);
    try {
      await flint.updateSettings({ google: { clientId: c.clientId, clientSecret: c.clientSecret } });
      onSaved();
    } catch (err) {
      setErrors({ save: err instanceof Error ? err.message : "Couldn't save the client. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.step}>
      <p className={styles.hint}>
        Google only lets an app sign in to Gmail with a client that belongs to someone. Making your own is free and takes about five minutes. The values stay on this computer.
      </p>
      <ol className={styles.steps} aria-label="Steps to create a Google client">
        {GOOGLE_STEPS.map((s) => (
          <li key={s.title}><strong>{s.title}.</strong> {s.body}</li>
        ))}
      </ol>
      <div><Button variant="ghost" size="sm" icon={<ExternalLink size={14} strokeWidth={1.5} />} onClick={() => openExternal(CONSOLE_URL)}>Open Google Cloud Console</Button></div>
      <label className={styles.field}>
        <span className={`t-label ${styles.label}`}>Client ID</span>
        <Input aria-label="Client ID" value={clientId} invalid={!!errors.clientId} placeholder="1234567890-abc.apps.googleusercontent.com" spellCheck={false} onChange={(e) => setClientId(e.target.value)} />
        {errors.clientId ? <span role="alert" className={styles.err}>{errors.clientId}</span> : null}
      </label>
      <label className={styles.field}>
        <span className={`t-label ${styles.label}`}>Client secret</span>
        <Input aria-label="Client secret" type="password" value={clientSecret} invalid={!!errors.clientSecret} autoComplete="off" spellCheck={false} onChange={(e) => setClientSecret(e.target.value)} />
        {errors.clientSecret ? <span role="alert" className={styles.err}>{errors.clientSecret}</span> : null}
      </label>
      {errors.save ? <p role="alert" className={styles.err}>{errors.save}</p> : null}
      <div className={styles.actions}><Button variant="primary" disabled={busy} onClick={() => void save()}>Save and continue</Button></div>
    </div>
  );
}
