import { useEffect, useState } from "react";
import type { Account, ServerConfig } from "@flint/core";
import { Button } from "../../../ui";
import { ServerFields } from "../../onboarding/ServerFields";
import styles from "../settings.module.css";
import type { AccountPatch } from "../useAccounts";

type Props = { account: Account; onSave: (patch: AccountPatch) => Promise<boolean> };

const serverOf = (a: ServerConfig): ServerConfig => ({
  imapHost: a.imapHost, imapPort: a.imapPort, imapSecure: a.imapSecure,
  smtpHost: a.smtpHost, smtpPort: a.smtpPort, smtpSecure: a.smtpSecure, username: a.username,
});

const sameServer = (a: ServerConfig, b: ServerConfig): boolean =>
  (Object.keys(a) as (keyof ServerConfig)[]).every((key) => a[key] === b[key]);

const validPort = (port: number): boolean => Number.isInteger(port) && port >= 1 && port <= 65535;

const isComplete = (s: ServerConfig): boolean =>
  s.imapHost.trim() !== "" && s.smtpHost.trim() !== "" && s.username.trim() !== "" && validPort(s.imapPort) && validPort(s.smtpPort);

/** Edits a password account's IMAP and SMTP settings. Saving logs in to the new servers first; a failure keeps the old settings. */
export function ServerEditor({ account, onSave }: Props) {
  const saved = serverOf(account);
  const [draft, setDraft] = useState<ServerConfig>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = !sameServer(draft, saved);

  // Show what was saved: after a save (the SMTP mode that worked may differ) or a change made elsewhere, such as signing in again.
  const savedKey = JSON.stringify(saved);
  useEffect(() => setDraft(JSON.parse(savedKey) as ServerConfig), [savedKey]);

  const save = async () => {
    setBusy(true);
    try {
      await onSave({ ...draft, imapHost: draft.imapHost.trim(), smtpHost: draft.smtpHost.trim(), username: draft.username.trim() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.field}>
      <span className={`t-label ${styles.fieldLabel}`}>Servers</span>
      <ServerFields server={draft} onChange={setDraft} />
      {dirty ? (
        <div className={styles.inline}>
          <Button variant="primary" disabled={busy || !isComplete(draft)} onClick={() => void save()}>
            {busy ? "Checking…" : "Save servers"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setDraft(saved)}>Cancel</Button>
        </div>
      ) : null}
    </div>
  );
}
