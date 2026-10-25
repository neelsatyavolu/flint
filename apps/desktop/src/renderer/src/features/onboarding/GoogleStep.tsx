import { useState } from "react";
import type { Account } from "@flint/core";
import { flint } from "../../lib/api";
import { useFlintQuery } from "../../lib/hooks";
import { Button } from "../../ui";
import { GoogleSetupPanel } from "./GoogleSetupPanel";
import styles from "./onboarding.module.css";

export function GoogleStep({ onDone }: { onDone: (a: Account) => void }) {
  const settings = useFlintQuery((api) => api.getSettings(), []);
  const [editing, setEditing] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!settings.data) return <p className={styles.muted} role="status">Loading…</p>;
  const g = settings.data.google;

  if (editing || g.clientId.trim() === "") {
    return <GoogleSetupPanel initialId={g.clientId} initialSecret={g.clientSecret} onSaved={() => { setEditing(false); settings.refetch(); }} />;
  }

  const signIn = async () => {
    setError(null);
    setWaiting(true);
    try {
      onDone(await flint.addGoogleAccount());
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Google sign-in didn't finish. Try again.");
      setWaiting(false);
    }
  };

  return (
    <div className={styles.step}>
      <p className={styles.hint}>Flint opens your browser so you can sign in with Google. Flint never sees your Google password.</p>
      {waiting ? (
        <div className={styles.wait} role="status"><span className={styles.pulse} aria-hidden /><span>Waiting for Google…</span></div>
      ) : (
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => void signIn()}>Sign in with Google</Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Change Google client</Button>
        </div>
      )}
      {error ? <p role="alert" className={styles.err}>{error}</p> : null}
    </div>
  );
}
