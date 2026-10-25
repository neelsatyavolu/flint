import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import clsx from "clsx";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon";
export type ButtonSize = "md" | "sm";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (16px lucide icon). */
  icon?: ReactNode;
  type?: "button" | "submit" | "reset";
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = "secondary", size = "md", icon, type = "button", className, children, ref, ...rest }: ButtonProps) {
  return (
    <button ref={ref} type={type} className={clsx(styles.button, styles[variant], styles[size], className)} {...rest}>
      {icon ? <span className={styles.lead}>{icon}</span> : null}
      {children}
    </button>
  );
}
