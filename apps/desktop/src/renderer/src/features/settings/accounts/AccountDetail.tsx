import { useState } from "react";
import type { Account, SyncStatus } from "@flint/core";
import { Button, Dialog } from "../../../ui";
import { ColorSwatches } from "../ColorSwatches";
import { DebouncedText } from "../fields";
import styles from "../settings.module.css";
import type { AccountPatch } from "../useAccounts";
import { AliasEditor } from "./AliasEditor";
import { describeStatus } from "./accountStatus";

type Props = {
  account: Account;
  sync: SyncStatus | undefined;
  onPatch: (patch: AccountPatch) => void;
  onRemove: () => Promise<void>;
  onSignIn: () => Promise<void>;
};

/** Edit panel under an account row: name, aliases, color, sign in again, remove. */
export function AccountDetail({ account, sync, onPatch, onRemove, onSignIn }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = describeStatus(sync, account.enabled);

  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    void fn().finally(() => setBusy(false));
  };

  return (
    <div className={styles.fields} style={{ padding: "var(--s-4) 0 var(--s-5)" }}>
      <label className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Name</span>
        <DebouncedText label="Account name" value={account.name} onCommit={(name) => name.trim() !== "" && onPatch({ name: name.trim() })} />
      </label>
      <div className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Aliases</span>
        <AliasEditor own={account.email} aliases={account.aliases} onChange={(aliases) => onPatch({ aliases })} />
      </div>
      <div className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Color</span>
        <ColorSwatches value={account.color} label={`Color for ${account.email}`} onChange={(color) => onPatch({ color })} />
      </div>
      <div className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Servers</span>
        <span className={`${styles.mono} ${styles.muted}`}>
          IMAP {account.imapHost}:{account.imapPort} · SMTP {account.smtpHost}:{account.smtpPort} · {account.authKind === "oauth_google" ? "Google sign-in" : "Password"}
        </span>
      </div>
      <div className={styles.inline}>
        {status.needsSignIn ? (
          <Button variant="primary" disabled={busy} onClick={() => run(onSignIn)}>Sign in again</Button>
        ) : null}
        <Button variant="danger" onClick={() => setConfirm(true)}>Remove account</Button>
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Remove this account?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={() => run(async () => { await onRemove(); setConfirm(false); })}>Remove</Button>
          </>
        }
      >
        <p className={styles.prose}>
          {account.email} and its mail stored on this computer will be removed from Flint. Your mail stays with your provider.
        </p>
      </Dialog>
    </div>
  );
}
