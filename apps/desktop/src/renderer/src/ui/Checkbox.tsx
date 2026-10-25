import { useEffect, useRef, type ReactNode } from "react";
import { Check, Minus } from "lucide-react";
import clsx from "clsx";
import styles from "./forms.module.css";

export type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  /** Accessible name when `label` is not shown. */
  ariaLabel?: string;
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
};

export function Checkbox({ checked, onChange, label, ariaLabel, indeterminate = false, disabled, className }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className={clsx(styles.check, className)}>
      <input
        ref={ref}
        type="checkbox"
        className={styles.checkInput}
        checked={checked}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.box} aria-hidden>
        {indeterminate ? <Minus size={12} strokeWidth={2} /> : <Check size={12} strokeWidth={2} />}
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  );
}
