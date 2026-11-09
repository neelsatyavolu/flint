import { useCallback, useEffect, useState } from "react";
import { Package } from "lucide-react";
import { PORCHLIGHT_CONNECT_URL } from "@flint/core/porchlight/config";
import type { PorchlightStatus } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { formatFullDate } from "../../../lib/format";
import { useFlintEvent } from "../../../lib/hooks";
import { openExternal } from "../../../lib/host";
import { Button, Input, Skeleton } from "../../../ui";
import { errorText } from "../useAccounts";
import styles from "../settings.module.css";

const codeChars = (code: string) => code.replace(/[^a-z0-9]/gi, "");

/**
 * Settings → Connected apps → Porchlight. "Connect Porchlight" opens porchlight.xanom.co, which sends back a flint:// link;
 * the main process asks the user to confirm and pairs. A typed code still works under "Use a code instead".
 */
export function PorchlightBlock() {
  const [status, setStatus] = useState<PorchlightStatus | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"pair" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setStatus(await flint.porchlightStatus()); }
    catch (err) { setError(errorText(err, "Couldn't load the Porchlight connection. Try again.")); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);
  useFlintEvent("porchlight", (e) => { setStatus(e.status); setNote(null); setError(null); });

  const connect = () => {
    setError(null);
    setNote("Finish in your browser. Flint will ask you to confirm the account.");
    openExternal(PORCHLIGHT_CONNECT_URL);
  };

  const pair = async () => {
    setBusy("pair");
    setError(null);
    setNote(null);
    try { setStatus(await flint.pairPorchlight(code.trim())); setCode(""); }
    catch (err) { setError(errorText(err, "Couldn't connect to Porchlight. Try again.")); }
    finally { setBusy(null); }
  };
  const disconnect = async () => {
    const label = status?.connection?.label ?? "Flint";
    setBusy("disconnect");
    setError(null);
    try {
      const { revoked } = await flint.disconnectPorchlight();
      setNote(revoked ? null : `Disconnected. To remove Flint's access in Porchlight too, delete “${label}” in Porchlight Settings.`);
      await refresh();
    } catch (err) { setError(errorText(err, "Couldn't disconnect Porchlight. Try again.")); }
    finally { setBusy(null); }
  };

  const connection = status?.connection ?? null;
  return (
    <div className={styles.group}>
      <h3 className={`t-label ${styles.groupLabel}`}>Porchlight</h3>
      {status === null ? <Skeleton height={80} /> : (
        <div className={styles.row}>
          <Package size={18} strokeWidth={1.5} color="var(--fg-2)" aria-hidden />
          <div className={styles.rowGrow}>
            <div className={styles.rowTitle}>Porchlight</div>
            {connection ? (
              <>
                <div className={styles.rowSub}>{connection.label}</div>
                {connection.signedOut
                  ? <p className={styles.warn}>Porchlight signed this Mac out. Connect again to resume.</p>
                  : <p className={styles.muted}>{connection.account ? `Connected to ${connection.account}` : "Connected"}</p>}
                <p className={`t-data ${styles.muted}`}>
                  {status.imported} {status.imported === 1 ? "package" : "packages"} sent{status.pending ? ` · ${status.pending} waiting` : ""}
                  {" · "}{status.lastImportAt ? `Last sent ${formatFullDate(status.lastImportAt)}` : "Nothing sent yet"}
                </p>
              </>
            ) : (
              <p className={styles.muted}>Track packages from your shipping mail in Porchlight.</p>
            )}
            <p className={`${styles.muted} ${styles.padTop}`}>Flint sends the carrier, tracking number, sender name, subject and date of shipping mail from the last 30 days and new mail. Never the message itself.</p>
          </div>
          <div className={styles.inline}>
            {connection ? <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void disconnect()}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</Button> : null}
            {!connection || connection.signedOut ? <Button variant="accent" size="sm" disabled={busy !== null} onClick={connect}>Connect Porchlight</Button> : null}
          </div>
        </div>
      )}
      {status && (!connection || connection.signedOut) ? (
        <details className={styles.padTop}>
          <summary className={styles.disclosure}>Use a code instead</summary>
          <form className={`${styles.stack} ${styles.padTop}`} onSubmit={(event) => { event.preventDefault(); void pair(); }}>
            <p className={styles.muted}>In Porchlight, open Settings, then Connections, then Flint, and copy the code.</p>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Porchlight code</span>
              <Input className={styles.mono} value={code} placeholder="ABCD-EFGH" maxLength={12} disabled={busy !== null} autoComplete="one-time-code" spellCheck={false} onChange={(event) => setCode(event.target.value)} />
            </label>
            <div className={styles.listActions}>
              <Button variant="ghost" type="submit" disabled={busy !== null || codeChars(code).length !== 8}>{busy === "pair" ? "Connecting…" : "Connect with code"}</Button>
            </div>
          </form>
        </details>
      ) : null}
      {note ? <p role="status" className={`${styles.muted} ${styles.padTop}`}>{note}</p> : null}
      {error ? <p role="alert" className={styles.err}>{error}</p> : null}
    </div>
  );
}
