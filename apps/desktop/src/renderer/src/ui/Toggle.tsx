import type { Ref } from "react";
import clsx from "clsx";
import styles from "./forms.module.css";

export type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name when there is no visible label next to the switch. */
  label: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  ref?: Ref<HTMLButtonElement>;
};

export function Toggle({ checked, onChange, label, disabled, className, id, ref }: ToggleProps) {
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={clsx(styles.toggle, className)}
      onClick={() => onChange(!checked)}
    />
  );
}
