import { useState } from "react";
import type { Account } from "@flint/core";
import { flint } from "../../lib/api";
import { useFlintQuery } from "../../lib/hooks";
import { Button } from "../../ui";
import type { ProviderId } from "./providers";
import { GoogleSetupPanel } from "./GoogleSetupPanel";
import styles from "./onboarding.module.css";

type Props = { onDone: (a: Account) => void; /** Lets the error well offer another route, such as Proton Mail Bridge. */ onSwitch?: (c: ProviderId) => void };

export function GoogleStep({ onDone, onSwitch }: Props) {
  const settings = useFlintQuery((api) => api.getSettings(), [], { mail: false });
  const [editing, setEditing] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!settings.data) return <p className={styles.muted} role="status">Loading…</p>;
  const g = settings.data.google;

  const ownClient = g.clientId.trim() !== "";
  // Builds ship Flint's own Google client (settings.google.builtIn), so the setup panel is only needed without one.
  if (editing || (!ownClient && !g.builtIn)) {
    return (
      <GoogleSetupPanel
        initialId={g.clientId}
        initialSecret={g.clientSecret}
        onSaved={() => { setEditing(false); settings.refetch(); }}
        {...(ownClient || g.builtIn ? { onCancel: () => setEditing(false) } : {})}
      />
    );
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
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>{ownClient ? "Change Google client" : "Use my own Google client"}</Button>
        </div>
      )}
      {error ? (
        <div role="alert" className={styles.errorWell}>
          <p>{error}</p>
          {onSwitch && /proton/i.test(error) ? (
            <div><Button variant="ghost" size="sm" onClick={() => onSwitch("proton-bridge")}>Set up Proton Mail (Bridge)</Button></div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
