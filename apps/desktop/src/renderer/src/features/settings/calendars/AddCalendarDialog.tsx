import { useState, type JSX } from "react";
import { ExternalLink } from "lucide-react";
import type { CalendarAccount } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { openExternal } from "../../../lib/host";
import { Button, Dialog, Input } from "../../../ui";
import { errorText } from "../useAccounts";
import { APPLE_PASSWORDS_URL, FASTMAIL_PASSWORDS_URL, KIND_LABEL, buildCalDavInput, parseAddresses, type CalDavErrors, type CalendarKind } from "./calendarForm";
import styles from "../settings.module.css";

type Props = {
  kind: CalendarKind | null;
  /** An address to cover from the start, e.g. the one an invitation was sent to. */
  address?: string;
  onClose: () => void;
  onAdded: (account: CalendarAccount) => void;
};

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: JSX.Element }) {
  return (
    <label className={styles.field}>
      <span className={`t-label ${styles.fieldLabel}`}>{label}</span>
      {children}
      {error ? <span role="alert" className={`t-data ${styles.err}`}>{error}</span> : hint ? <span className={`t-data ${styles.muted}`}>{hint}</span> : null}
    </label>
  );
}

function ExternalLinkButton({ href, children }: { href: string; children: string }) {
  return (
    <Button variant="ghost" size="sm" icon={<ExternalLink size={14} strokeWidth={1.5} />} onClick={() => openExternal(href)}>{children}</Button>
  );
}

function HowTo({ kind }: { kind: CalendarKind }) {
  if (kind === "icloud") {
    return (
      <div className={styles.stack}>
        <ol className={styles.prose} style={{ paddingLeft: 20, listStyle: "decimal" }}>
          <li>Sign in at appleid.apple.com and open Sign-In and Security.</li>
          <li>Choose App-Specific Passwords and create one named Flint.</li>
          <li>Paste it below. Your normal Apple ID password will not work.</li>
        </ol>
        <div><ExternalLinkButton href={APPLE_PASSWORDS_URL}>Open appleid.apple.com</ExternalLinkButton></div>
      </div>
    );
  }
  if (kind === "fastmail") {
    return (
      <div className={styles.stack}>
        <p className={styles.prose}>In Fastmail, open Settings, Privacy and Security, then New app password. Give it access to Calendars (CalDAV) and paste it below.</p>
        <div><ExternalLinkButton href={FASTMAIL_PASSWORDS_URL}>Open Fastmail app passwords</ExternalLinkButton></div>
      </div>
    );
  }
  if (kind === "other") return <p className={styles.prose}>Use the CalDAV address, username and password from your calendar provider. The address must start with https://.</p>;
  return <p className={styles.prose}>A Google window opens to ask for calendar access only. Flint does not read your Gmail through this sign-in.</p>;
}

/** One dialog for all four ways to add a calendar. The form is remounted per kind so fields start empty. */
export function AddCalendarDialog({ kind, address, onClose, onAdded }: Props): JSX.Element {
  return (
    <Dialog open={kind !== null} onClose={onClose} title={kind ? `Add ${KIND_LABEL[kind]}` : "Add calendar"} width={520}>
      {kind ? <AddForm key={kind} kind={kind} address={address} onClose={onClose} onAdded={onAdded} /> : null}
    </Dialog>
  );
}

function AddForm({ kind, address, onClose, onAdded }: Omit<Props, "kind"> & { kind: CalendarKind }) {
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginHint, setLoginHint] = useState(kind === "google" ? address ?? "" : "");
  const [addresses, setAddresses] = useState(kind !== "google" || !address ? (address ?? "") : "");
  const [errors, setErrors] = useState<CalDavErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clear = (k: keyof CalDavErrors) => { setErrors((e) => ({ ...e, [k]: undefined })); setFailure(null); };

  const submit = async () => {
    if (busy) return;
    setFailure(null);
    try {
      let account: CalendarAccount;
      if (kind === "google") {
        const hint = loginHint.trim();
        const extra = parseAddresses(addresses, [hint]);
        if (!extra.ok) return setErrors({ addresses: extra.message });
        setBusy(true);
        account = await flint.addGoogleCalendarAccount({ ...(hint ? { loginHint: hint } : {}), ...(extra.values.length > 0 ? { extraAddresses: extra.values } : {}) });
      } else {
        const built = buildCalDavInput({ kind, url, username, password, addresses });
        if (built.errors) return setErrors(built.errors);
        setBusy(true);
        account = await flint.addCalDavAccount(built.input);
      }
      onAdded(account);
    } catch (err) {
      setFailure(errorText(err, kind === "google" ? "Google sign-in didn't finish. Try again." : "Couldn't connect to the calendar. Check the details and try again."));
    } finally {
      setBusy(false);
    }
  };

  const submitOnEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } };
  const passwordLabel = kind === "other" ? "Password" : "App-specific password";

  return (
    <div className={styles.stack} onKeyDown={submitOnEnter}>
      <HowTo kind={kind} />
      <div className={styles.fields}>
        {kind === "google" ? (
          <Field label="Google account email (optional)" hint="Pick this account in the Google window." error={undefined}>
            <Input type="email" autoComplete="email" value={loginHint} placeholder="you@gmail.com" onChange={(e) => { setLoginHint(e.target.value); setFailure(null); }} />
          </Field>
        ) : (
          <>
            {kind === "other" ? (
              <Field label="Server address" error={errors.url}>
                <Input value={url} invalid={!!errors.url} placeholder="https://caldav.example.com" spellCheck={false} onChange={(e) => { setUrl(e.target.value); clear("url"); }} />
              </Field>
            ) : null}
            <Field label={kind === "icloud" ? "Apple ID" : kind === "fastmail" ? "Fastmail address" : "Username"} error={errors.username}>
              <Input value={username} invalid={!!errors.username} autoComplete="username" spellCheck={false} placeholder={kind === "other" ? "" : "you@example.com"} onChange={(e) => { setUsername(e.target.value); clear("username"); }} />
            </Field>
            <Field label={passwordLabel} error={errors.password}>
              <Input type="password" value={password} invalid={!!errors.password} autoComplete="current-password" onChange={(e) => { setPassword(e.target.value); clear("password"); }} />
            </Field>
          </>
        )}
        <Field label="Also answers invitations sent to (optional)" error={errors.addresses} hint="Aliases or another mailbox that invites into this calendar. Separate with commas.">
          <Input value={addresses} invalid={!!errors.addresses} placeholder="alias@example.com" spellCheck={false} onChange={(e) => { setAddresses(e.target.value); clear("addresses"); }} />
        </Field>
      </div>
      {failure ? <p role="alert" className={styles.err}>{failure}</p> : null}
      <div className={styles.inline} style={{ justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {kind === "google" ? (busy ? "Waiting for Google" : "Continue with Google") : busy ? "Connecting" : "Add calendar"}
        </Button>
      </div>
    </div>
  );
}
