import { Check } from "lucide-react";
import clsx from "clsx";
import { format } from "date-fns";
import { Checkbox, Input, MailFrame, SectionLabel } from "../../../ui";
import type { SparkRow } from "./sparkRows";
import styles from "./spark.module.css";

type Props = {
  row: SparkRow;
  onCheck: (checked: boolean) => void;
  onRename: (name: string) => void;
  onToggleDefault: (accountId: string) => void;
};

export function SparkSignatureRow({ row, onCheck, onRename, onToggleDefault }: Props) {
  return (
    <li className={clsx(styles.row, !row.checked && styles.off)}>
      <Checkbox checked={row.checked} onChange={onCheck} ariaLabel={`Import ${row.label || row.name}`} />
      <div className={styles.body}>
        <div className={styles.head}>
          <Input className={styles.name} aria-label="Signature name" value={row.label} placeholder={row.name} onChange={(e) => onRename(e.target.value)} />
          {row.modifiedAt > 0 ? <span className={styles.date}>Edited {format(new Date(row.modifiedAt), "MMM d, yyyy")}</span> : null}
        </div>
        <div className={styles.preview}>
          <MailFrame html={row.html} allowRemoteImages title={`Preview of ${row.label || row.name}`} padding={12} />
        </div>
        {row.matches.length > 0 ? (
          <div className={styles.defaults} role="group" aria-label="Default for">
            <SectionLabel className={styles.defaultsLabel}>Default for</SectionLabel>
            {row.matches.map((m) => {
              const on = row.defaults.includes(m.accountId);
              return (
                <button key={m.accountId} type="button" className={clsx(styles.chip, on && styles.chipOn)} aria-pressed={on} onClick={() => onToggleDefault(m.accountId)}>
                  {on ? <Check size={12} strokeWidth={1.5} /> : null}
                  {m.email}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </li>
  );
}
