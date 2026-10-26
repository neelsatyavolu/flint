import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { ACCOUNT_COLORS } from "./accountColors";
import styles from "./settings.module.css";

const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();

/**
 * The account color picker: a radio group of swatches with a check on the chosen one. A pick shows at once and stays
 * until the saved value catches up, so a slow save never makes the click look ignored. Arrow keys move and pick.
 */
export function ColorSwatches({ value, onChange, label }: { value: string | null; onChange: (c: string) => void; label: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => setPicked(null), [value]);
  const current = picked ?? value;
  const at = ACCOUNT_COLORS.findIndex((c) => same(current, c));

  const pick = (i: number) => {
    const c = ACCOUNT_COLORS[(i + ACCOUNT_COLORS.length) % ACCOUNT_COLORS.length]!;
    setPicked(c);
    onChange(c);
    return ACCOUNT_COLORS.indexOf(c);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    refs.current[pick(Math.max(at, 0) + step)]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={styles.swatches} onKeyDown={onKeyDown}>
      {ACCOUNT_COLORS.map((c, i) => {
        const on = i === at;
        return (
          <button
            key={c}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={c}
            tabIndex={on || (at === -1 && i === 0) ? 0 : -1}
            className={`${styles.swatch} ${on ? styles.swatchOn : ""}`}
            onClick={() => void pick(i)}
          >
            <span className={styles.swatchFill} style={{ background: c }} aria-hidden>
              {on ? <Check size={14} strokeWidth={2.5} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
