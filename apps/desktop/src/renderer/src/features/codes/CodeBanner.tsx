import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import clsx from "clsx";
import type { CodeBadge } from "@flint/core/types";
import { Button } from "../../ui";
import { copyCode } from "./copyCode";
import { minutesLeft, useLiveCode } from "./useLiveCode";
import styles from "./Codes.module.css";

/** The verification code found in a message, shown above its body with a Copy button. Hidden once it expires. */
export function CodeBanner({ badge }: { badge: CodeBadge | undefined }) {
  const live = useLiveCode(badge);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!live) return null;
  const { badge: b, now } = live;
  const copy = async () => {
    if (!(await copyCode(b.code))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  const left = minutesLeft(b.expiresAt, now);
  return (
    <section className={styles.banner} aria-label="Verification code">
      <div className={styles.bannerText}>
        <span className={clsx("t-label", styles.label)}>Verification code · {b.service}</span>
        <span className={styles.big} data-testid="code-value">{b.code}</span>
      </div>
      <div className={styles.bannerSide}>
        <span className={clsx("t-data", styles.expiry)}>{b.used ? "Used · " : ""}Expires in {left} {left === 1 ? "minute" : "minutes"}</span>
        <Button variant="primary" size="sm" icon={copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </section>
  );
}
