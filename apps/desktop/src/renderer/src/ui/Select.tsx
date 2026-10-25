import type { Ref, SelectHTMLAttributes } from "react";
import { ChevronsUpDown } from "lucide-react";
import clsx from "clsx";
import styles from "./forms.module.css";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> };

/** Native select (keyboard and screen reader behaviour for free), styled per DESIGN §5. Pass <option> children. */
export function Select({ className, children, ref, ...rest }: SelectProps) {
  return (
    <span className={styles.selectWrap}>
      <select ref={ref} className={clsx(styles.field, styles.select, className)} {...rest}>
        {children}
      </select>
      <span className={styles.chevron}><ChevronsUpDown size={14} strokeWidth={1.5} /></span>
    </span>
  );
}
