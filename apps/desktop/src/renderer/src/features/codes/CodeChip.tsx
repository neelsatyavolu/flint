import { useState, type MouseEvent } from "react";
import type { CodeBadge } from "@flint/core/types";
import { copyCode } from "./copyCode";
import { useLiveCode } from "./useLiveCode";
import styles from "./Codes.module.css";

/** Small code chip on a thread row. Click copies the code without opening the thread. Hidden once the code expires or is used. */
export function CodeChip({ badge }: { badge: CodeBadge | undefined }) {
  const live = useLiveCode(badge);
  const [copied, setCopied] = useState(false);
  if (!live || live.badge.used) return null;
  const { code } = live.badge;
  const copy = (e: MouseEvent) => {
    e.stopPropagation();
    void copyCode(code).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button type="button" className={`t-data ${styles.chip}`} title="Copy code" aria-label={copied ? "Copied" : `Copy code ${code}`} onClick={copy}>
      {copied ? "Copied" : code}
    </button>
  );
}
