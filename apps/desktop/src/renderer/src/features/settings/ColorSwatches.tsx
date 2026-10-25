import { ACCOUNT_COLORS } from "./accountColors";
import styles from "./settings.module.css";

export function ColorSwatches({ value, onChange, label }: { value: string | null; onChange: (c: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.swatches}>
      {ACCOUNT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className={`${styles.swatch} ${value === c ? styles.swatchOn : ""}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}
