import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Account, ServerConfig } from "@flint/core";
import { flint } from "../../lib/api";
import { openExternal } from "../../lib/host";
import { Button, Input } from "../../ui";
import { EMPTY_SERVER, connectionProblems, describeServer, toInput, validateForm, type FormErrors } from "./imapFlow";
import { PROTON_BRIDGE_HINT, type ProviderPreset } from "./providers";
import { ServerFields } from "./ServerFields";
import styles from "./onboarding.module.css";

type Detect = { kind: "idle" } | { kind: "checking" } | { kind: "found" } | { kind: "missing" };

type Props = {
  preset: ProviderPreset;
  onDone: (a: Account) => void;
  /** Re-entering a password for an existing account: address, name and servers are fixed. */
  reauth?: Account;
};

export function ImapStep({ preset, onDone, reauth }: Props) {
  const [email, setEmail] = useState(reauth?.email ?? "");
  const [name, setName] = useState(reauth?.name ?? "");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState<ServerConfig | null>(reauth ?? null);
  const [detect, setDetect] = useState<Detect>({ kind: "idle" });
  const [editServers, setEditServers] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState<"testing" | "adding" | null>(null);
  const [synced, setSynced] = useState<string | null>(null);
  const [bridge, setBridge] = useState(preset.id === "proton-bridge");
  const touched = useRef(false);
  const seq = useRef(0);

  const lookup = async (address: string) => {
    const trimmed = address.trim();
    if (reauth || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    if (preset.servers) {
      if (!touched.current) setServer(preset.servers(trimmed));
      setDetect({ kind: "found" });
      return;
    }
    const id = ++seq.current;
    setDetect({ kind: "checking" });
    try {
      const found = await flint.autoconfig(trimmed);
      if (id !== seq.current) return;
      if (found && !touched.current) {
        setServer(found);
        setBridge(found.hint === "proton_bridge");
        setDetect({ kind: "found" });
      } else if (!found) {
        setServer((s) => s ?? { ...EMPTY_SERVER, username: trimmed });
        setDetect({ kind: "missing" });
        setEditServers(true);
      }
    } catch {
      if (id !== seq.current) return;
      setServer((s) => s ?? { ...EMPTY_SERVER, username: trimmed });
      setDetect({ kind: "missing" });
      setEditServers(true);
    }
  };

  const changeServer = (s: ServerConfig) => {
    touched.current = true;
    setServer(s);
  };

  const connect = async () => {
    const form = { email, name, password, server };
    const found = validateForm(form);
    setErrors(found);
    setProblems([]);
    if (Object.keys(found).length > 0) {
      if (found.server) setEditServers(true);
      return;
    }
    const input = toInput(form, reauth?.provider ?? preset.provider);
    setBusy("testing");
    try {
      const result = await flint.testConnection(input);
      const bad = connectionProblems(result, input.server ?? null);
      if (bad.length > 0) {
        setProblems(bad);
        return;
      }
      setBusy("adding");
      const account = await flint.addAccount(input);
      setSynced(account.email);
      onDone(account);
    } catch (err) {
      setProblems([err instanceof Error && err.message ? err.message : "Couldn't connect. Check the details and try again."]);
    } finally {
      setBusy(null);
    }
  };

  if (synced) {
    return <div className={styles.wait} role="status"><span className={styles.pulse} aria-hidden /><span>Syncing your mail for {synced}</span></div>;
  }

  const emailLocked = reauth !== undefined;
  return (
    <form className={styles.step} onSubmit={(e) => { e.preventDefault(); void connect(); }} noValidate>
      <p className={styles.hint}>{bridge ? PROTON_BRIDGE_HINT : preset.passwordHint}</p>
      {preset.helpUrl ? (
        <div><Button variant="ghost" size="sm" icon={<ExternalLink size={14} strokeWidth={1.5} />} onClick={() => openExternal(preset.helpUrl!)}>{preset.helpLabel ?? "Open"}</Button></div>
      ) : null}
      <label className={styles.field}>
        <span className={`t-label ${styles.label}`}>Email</span>
        <Input type="email" autoComplete="email" value={email} readOnly={emailLocked} invalid={!!errors.email} placeholder="you@example.com" onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }} onBlur={() => void lookup(email)} />
        {errors.email ? <span role="alert" className={styles.err}>{errors.email}</span> : null}
      </label>
      <label className={styles.field}>
        <span className={`t-label ${styles.label}`}>Name</span>
        <Input autoComplete="name" value={name} invalid={!!errors.name} placeholder="How your name appears to others" onChange={(e) => setName(e.target.value)} />
        {errors.name ? <span role="alert" className={styles.err}>{errors.name}</span> : null}
      </label>
      <label className={styles.field}>
        <span className={`t-label ${styles.label}`}>{preset.id === "gmail-app" ? "App password" : "Password"}</span>
        <Input type="password" autoComplete="current-password" value={password} invalid={!!errors.password} onChange={(e) => setPassword(e.target.value)} />
        {errors.password ? <span role="alert" className={styles.err}>{errors.password}</span> : null}
      </label>

      <div aria-live="polite">
        {detect.kind === "checking" ? <span className={styles.muted}>Looking up your mail servers…</span> : null}
        {server && detect.kind !== "checking" && detect.kind !== "missing" ? (
          <div className={styles.detected}>
            <span className={styles.ok}>{reauth ? "Using the saved servers" : "Servers found"}</span>
            <span className={styles.mono}>{describeServer(server)}</span>
          </div>
        ) : null}
        {detect.kind === "missing" ? <span className={styles.err}>Couldn't find the servers for this address. Enter them below.</span> : null}
      </div>
      {errors.server ? <span role="alert" className={styles.err}>{errors.server}</span> : null}

      {!reauth ? (
        <>
          <Button variant="ghost" size="sm" className={styles.disclosure} aria-expanded={editServers} onClick={() => { setEditServers((v) => !v); setServer((s) => s ?? { ...EMPTY_SERVER, username: email.trim() }); }}>
            {editServers ? "Hide servers" : "Edit servers"}
          </Button>
          {editServers && server ? <ServerFields server={server} onChange={changeServer} /> : null}
        </>
      ) : null}

      {problems.length > 0 ? (
        <div role="alert" className={styles.problems}>{problems.map((p) => <span key={p} className={styles.err}>{p}</span>)}</div>
      ) : null}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={busy !== null}>
          {busy === "testing" ? "Checking the servers…" : busy === "adding" ? "Adding…" : "Connect"}
        </Button>
      </div>
    </form>
  );
}
