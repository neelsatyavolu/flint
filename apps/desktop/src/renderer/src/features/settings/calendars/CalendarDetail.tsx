import { useState } from "react";
import { X } from "lucide-react";
import type { CalendarAccount } from "@flint/core/types";
import { Button, Dialog, IconButton, Input } from "../../../ui";
import { parseAddresses } from "./calendarForm";
import styles from "../settings.module.css";

type Props = {
  calendar: CalendarAccount;
  onRename: (name: string) => Promise<void>;
  onAddresses: (extra: string[]) => Promise<void>;
  onRemove: () => Promise<void>;
  /** Google calendars only: ask for consent again. */
  onSignIn?: () => Promise<void>;
};

/** Expanded row: rename, the addresses this calendar answers for, and remove. Implicit Gmail entries are read-only here. */
export function CalendarDetail({ calendar, onRename, onAddresses, onRemove, onSignIn }: Props) {
  const implicit = calendar.viaMailAccountId !== null;
  const [name, setName] = useState(calendar.name);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const add = () => {
    if (!text.trim()) return;
    const c = parseAddresses(text, calendar.addresses);
    if (!c.ok) return setError(c.message);
    if (c.values.length === 0) return setError("Those addresses are already covered.");
    setError(null);
    setText("");
    void run(() => onAddresses([...calendar.extraAddresses, ...c.values]));
  };

  const own = calendar.addresses.filter((a) => !calendar.extraAddresses.includes(a));
  return (
    <div className={`${styles.stack} ${styles.detail}`}>
      {implicit ? (
        <p className={styles.prose}>This is the calendar of a Google mail account. Manage it in Settings, Accounts.</p>
      ) : (
        <label className={styles.field}>
          <span className={`t-label ${styles.fieldLabel}`}>Name</span>
          <Input value={name} className={styles.wide} onChange={(e) => setName(e.target.value)} onBlur={() => { const n = name.trim(); if (n && n !== calendar.name) void run(() => onRename(n)); else setName(calendar.name); }} />
        </label>
      )}
      <div className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Answers invitations sent to</span>
        <div className={styles.chips}>
          {own.map((a) => <span key={a} className={styles.chip}>{a}</span>)}
          {calendar.extraAddresses.map((a) => (
            <span key={a} className={styles.chip}>
              {a}
              <IconButton label={`Remove ${a}`} size={24} disabled={busy} onClick={() => void run(() => onAddresses(calendar.extraAddresses.filter((x) => x !== a)))}><X size={12} strokeWidth={1.5} /></IconButton>
            </span>
          ))}
        </div>
      </div>
      {implicit ? null : (
        <>
          <div className={styles.inline}>
            <Input aria-label="Add an address" className={styles.wide} value={text} invalid={error !== null} placeholder="alias@example.com" spellCheck={false}
              onChange={(e) => { setText(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
            <Button variant="ghost" disabled={busy} onClick={add}>Add address</Button>
          </div>
          {error ? <p role="alert" className={styles.err}>{error}</p> : null}
          {calendar.statusMessage && calendar.status !== "ok" ? <p className={`t-data ${styles.err}`}>{calendar.statusMessage}</p> : null}
          <div className={styles.inline}>
            {calendar.status === "needs-signin" && onSignIn ? <Button variant="primary" disabled={busy} onClick={() => void run(onSignIn)}>Sign in again</Button> : null}
            <Button variant="danger" onClick={() => setConfirm(true)}>Remove calendar</Button>
          </div>
          <Dialog open={confirm} onClose={() => setConfirm(false)} title="Remove this calendar?"
            footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void run(async () => { await onRemove(); setConfirm(false); })}>Remove</Button></>}>
            <p className={styles.prose}>Flint forgets the sign-in for {calendar.name}. Your events stay with your provider. Invitations to these addresses are answered by email again.</p>
          </Dialog>
        </>
      )}
    </div>
  );
}
