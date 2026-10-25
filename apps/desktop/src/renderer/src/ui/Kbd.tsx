import clsx from "clsx";
import { formatCombo } from "../lib/shortcuts";
import styles from "./Kbd.module.css";

/** Shortcut hint in Data style. Pass `combo` ("mod+k", "g i") or plain children. */
export function Kbd({ combo, children, className }: { combo?: string; children?: string; className?: string }) {
  return <kbd className={clsx(styles.kbd, className)}>{combo ? formatCombo(combo) : children}</kbd>;
}
