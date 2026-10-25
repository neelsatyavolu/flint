import type { ReactNode, Ref } from "react";
import clsx from "clsx";
import { Tooltip } from "./Tooltip";
import styles from "./IconButton.module.css";

export type IconButtonProps = {
  /** Accessible name and tooltip text. */
  label: string;
  /** Combo shown in the tooltip, e.g. "e". */
  shortcut?: string;
  /** 28px by default; 24 for hover clusters. */
  size?: 24 | 28 | 32;
  /** Accent glyph: active nav item, +AI, Send. */
  tone?: "default" | "accent";
  /** Accent fill (Send). */
  filled?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
  tooltipPlacement?: "top" | "bottom" | "left" | "right";
  ref?: Ref<HTMLButtonElement>;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick" | "disabled" | "className">;

export function IconButton({
  label, shortcut, size = 28, tone = "default", filled = false, pressed, className, children, tooltipPlacement, ref, ...rest
}: IconButtonProps) {
  return (
    <Tooltip label={label} shortcut={shortcut} placement={tooltipPlacement}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        className={clsx(styles.btn, styles[`s${size}`], tone === "accent" && styles.accent, filled && styles.filled, pressed && styles.pressed, className)}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}
