import { useEffect, useState, type JSX } from "react";
import { flint } from "../../lib/api";
import { Button } from "../../ui";
import { SparkImportSheet } from "../settings/spark/SparkImportSheet";
import styles from "./onboarding.module.css";

/**
 * After the first account is added: one quiet line offering to bring signatures over from Spark.
 * It shows only when Spark has signatures, never blocks the mail view, and leaves without a word when it can't read them.
 */
export function SparkOffer({ onDone }: { onDone: () => void }): JSX.Element | null {
  const [found, setFound] = useState(false);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    let alive = true;
    flint.findSparkSignatures().then(
      (scan) => {
        if (!alive) return;
        if (scan && scan.signatures.length > 0) setFound(true);
        else onDone();
      },
      () => alive && onDone(),
    );
    return () => {
      alive = false;
    };
    // The offer is decided once, when it mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!found) return null;
  return (
    <>
      {sheet ? null : (
        <div className={styles.offer} role="region" aria-label="Spark signatures">
          <span>Bring your signatures from Spark?</span>
          <Button variant="primary" size="sm" onClick={() => setSheet(true)}>Import</Button>
          <Button variant="ghost" size="sm" onClick={onDone}>Skip</Button>
        </div>
      )}
      <SparkImportSheet open={sheet} onClose={onDone} onImported={onDone} />
    </>
  );
}
