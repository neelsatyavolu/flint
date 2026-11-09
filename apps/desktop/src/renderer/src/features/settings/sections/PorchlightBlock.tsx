import { useCallback, useEffect, useState } from "react";
import { Package } from "lucide-react";
import type { PorchlightStatus } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { formatFullDate } from "../../../lib/format";
import { Button, Input, Skeleton } from "../../../ui";
import { errorText } from "../useAccounts";
import styles from "../settings.module.css";

const codeChars = (code: string) => code.replace(/[^a-z0-9]/gi, "");

/** Settings → Connected apps → Porchlight: pair with a code from porchlight.xanom.co, see what was sent, disconnect. */
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
    <div className={styles.padTop}>
      <h3 className={`t-label ${styles.groupLabel}`}>Porchlight</h3>
      {status === null ? <Skeleton height={80} /> : (
        <div className={styles.row}>
          <Package size={20} strokeWidth={1.5} color="var(--accent)" aria-hidden />
          <div className={styles.rowGrow}>
            <div className={styles.rowTitle}>Porchlight</div>
            {connection ? (
              <>
                <div className={styles.rowSub}>{connection.label}</div>
                {connection.signedOut
                  ? <p className={styles.warn}>Porchlight signed this Mac out. Enter a new code to resume.</p>
                  : <p className={styles.muted}>Connected</p>}
                <p className={`t-data ${styles.muted}`}>
                  {status.imported} {status.imported === 1 ? "package" : "packages"} sent{status.pending ? ` · ${status.pending} waiting` : ""}
                  {" · "}{status.lastImportAt ? `Last sent ${formatFullDate(status.lastImportAt)}` : "Nothing sent yet"}
                </p>
              </>
            ) : (
              <p className={styles.muted}>Track packages from your shipping mail. Get a code in Porchlight at porchlight.xanom.co, under Settings → Connections → Flint.</p>
            )}
            <p className={`${styles.muted} ${styles.padTop}`}>Flint sends the carrier, tracking number, sender name, subject and date of shipping mail from the last 30 days and new mail. Never the message itself.</p>
          </div>
          {connection ? (
            <div className={styles.inline}>
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void disconnect()}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</Button>
            </div>
          ) : null}
        </div>
      )}
      {status && (!connection || connection.signedOut) ? (
        <form className={`${styles.stack} ${styles.padTop}`} onSubmit={(event) => { event.preventDefault(); void pair(); }}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Porchlight code</span>
            <Input className={styles.mono} value={code} placeholder="ABCD-EFGH" maxLength={12} disabled={busy !== null} autoComplete="one-time-code" spellCheck={false} onChange={(event) => setCode(event.target.value)} />
          </label>
          <div className={styles.listActions}>
            <Button variant="primary" type="submit" disabled={busy !== null || codeChars(code).length !== 8}>{busy === "pair" ? "Connecting…" : "Connect Porchlight"}</Button>
          </div>
        </form>
      ) : null}
      {note ? <p role="status" className={`${styles.muted} ${styles.padTop}`}>{note}</p> : null}
      {error ? <p role="alert" className={styles.err}>{error}</p> : null}
    </div>
  );
}
