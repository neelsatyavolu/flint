import { useState } from "react";
import type { Account, SyncStatus } from "@flint/core";
import { flint } from "../../../lib/api";
import { Button, Dialog, SettingsRow, Toggle, useToast } from "../../../ui";
import { ColorSwatches } from "../ColorSwatches";
import { DebouncedText } from "../fields";
import styles from "../settings.module.css";
import { errorText, type AccountPatch } from "../useAccounts";
import { AccountPhoto } from "./AccountPhoto";
import { AliasEditor } from "./AliasEditor";
import { describeStatus } from "./accountStatus";

type Props = {
  account: Account;
  sync: SyncStatus | undefined;
  onPatch: (patch: AccountPatch) => void;
  onRemove: () => Promise<void>;
  onSignIn: () => Promise<void>;
  /** Called after something outside onPatch changed the account (its photo). */
  onChanged?: () => void;
};

/** Edit panel under an account row: name, photo, aliases, color, unified inbox, sign in again, remove. */
export function AccountDetail({ account, sync, onPatch, onRemove, onSignIn, onChanged }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const status = describeStatus(sync, account.enabled);

  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    void fn().finally(() => setBusy(false));
  };

  const connectCalendar = () => run(async () => {
    try {
      await flint.connectGoogleCalendar(account.id);
      onChanged?.();
    } catch (err) {
      toast.show({ message: errorText(err, "Google Calendar didn't connect. Try again."), level: "error" });
    }
  });

  return (
    <div className={`${styles.fields} ${styles.detail}`}>
      <label className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Name</span>
        <DebouncedText label="Account name" value={account.name} onCommit={(name) => name.trim() !== "" && onPatch({ name: name.trim() })} />
      </label>
      <AccountPhoto account={account} onChanged={() => onChanged?.()} />
      <SettingsRow
        title="Show in unified inbox"
        description={
          account.showInUnified
            ? "Mail from this account appears in All accounts, Home and the dock badge."
            : "Mail from this account is left out of All accounts, Home and the dock badge. Open the account in the sidebar to read it."
        }
      >
        <Toggle checked={account.showInUnified} label={`Show ${account.email} in the unified inbox`} onChange={(showInUnified) => onPatch({ showInUnified })} />
      </SettingsRow>
      {account.authKind === "oauth_google" ? (
        <SettingsRow
          title="Google Calendar"
          description={account.calendarScope
            ? "Connected. Answering an invitation updates your calendar, and Flint shows conflicts."
            : "Connect to answer invitations from Flint and see conflicts with your calendar."}
        >
          {account.calendarScope ? <span className={`${styles.mono} ${styles.muted}`}>Connected</span> : <Button disabled={busy} onClick={connectCalendar}>Connect Google Calendar</Button>}
        </SettingsRow>
      ) : null}
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
