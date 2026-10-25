import { useCallback, useEffect, useRef, useState } from "react";
import type { Signature, SparkSignatureScan } from "@flint/core";
import { flint } from "../../../lib/api";
import { getHost } from "../../../lib/host";
import { pluralize } from "../../../lib/format";
import { Button, Dialog, useToast } from "../../../ui";
import { errorText } from "../useAccounts";
import { SparkSignatureRow } from "./SparkSignatureRow";
import { importMessage, patchRow, selectedCount, toImportInput, toRows, toggleDefault, type SparkRow } from "./sparkRows";
import styles from "./spark.module.css";

type Load =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; path: string; rows: SparkRow[] };

type Props = {
  open: boolean;
  onClose: () => void;
  onImported?: (signatures: Signature[]) => void;
};

/** Where a picked settings.sqlite lives: Electron resolves it from the File, the web preview only knows its name. */
function pathOfFile(file: File): string {
  return getHost()?.getPathForFile?.(file) || (file as File & { path?: string }).path || file.name;
}

const ready = (scan: SparkSignatureScan): Load => ({ kind: "ready", path: scan.path, rows: toRows(scan.signatures) });

export function SparkImportSheet({ open, onClose, onImported }: Props) {
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const scan = useCallback((path?: string) => {
    setLoad({ kind: "loading" });
    flint.findSparkSignatures(path).then(
      (result) => setLoad(result ? ready(result) : { kind: "missing" }),
      (err: unknown) => setLoad({ kind: "error", message: errorText(err, "Couldn't read Spark's signatures. Try again.") }),
    );
  }, []);

  useEffect(() => {
    if (open) scan();
  }, [open, scan]);

  const setRows = (fn: (rows: SparkRow[]) => SparkRow[]) =>
    setLoad((l) => (l.kind === "ready" ? { ...l, rows: fn(l.rows) } : l));

  const count = load.kind === "ready" ? selectedCount(load.rows) : 0;

  const doImport = async () => {
    if (load.kind !== "ready") return;
    setBusy(true);
    try {
      const saved = await flint.importSparkSignatures(toImportInput(load.path, load.rows));
      toast.show({ message: importMessage(saved.length, load.rows) });
      onImported?.(saved);
      onClose();
    } catch (err) {
      toast.show({ message: errorText(err, "Couldn't import the signatures. Try again."), level: "error" });
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      <input
        ref={picker}
        type="file"
        className={styles.hidden}
        aria-label="Spark settings file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) scan(pathOfFile(file));
        }}
      />
      <Button variant="ghost" className={styles.footerNote} onClick={() => picker.current?.click()}>Choose file…</Button>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={count === 0 || busy} onClick={() => void doImport()}>
        {count === 0 ? "Import signatures" : `Import ${pluralize(count, "signature")}`}
      </Button>
    </>
  );

  return (
    <Dialog open={open} onClose={onClose} title="Import from Spark" width={680} footer={footer}>
      {load.kind === "loading" ? <p className={styles.note}>Reading Spark's signatures…</p> : null}
      {load.kind === "missing" ? <p className={styles.note}>Spark isn't installed on this Mac. If you have its settings.sqlite file somewhere else, choose it.</p> : null}
      {load.kind === "error" ? <p className={styles.error} role="alert">{load.message}</p> : null}
      {load.kind === "ready" && load.rows.length === 0 ? <p className={styles.note}>Spark has no signatures to import.</p> : null}
      {load.kind === "ready" && load.rows.length > 0 ? (
        <ul className={styles.list} style={{ listStyle: "none", padding: 0 }}>
          {load.rows.map((row) => (
            <SparkSignatureRow
              key={row.sparkId}
              row={row}
              onCheck={(checked) => setRows((rs) => patchRow(rs, row.sparkId, { checked }))}
              onRename={(label) => setRows((rs) => patchRow(rs, row.sparkId, { label }))}
              onToggleDefault={(accountId) => setRows((rs) => toggleDefault(rs, row.sparkId, accountId))}
            />
          ))}
        </ul>
      ) : null}
      {load.kind === "ready" && load.rows.some((r) => r.matches.length > 0) ? (
        <p className={styles.note}>The accounts marked above get that signature by default for new mail and replies, replacing what they have now. Spark's fonts are dropped so signatures use the font Flint writes in.</p>
      ) : null}
    </Dialog>
  );
}
