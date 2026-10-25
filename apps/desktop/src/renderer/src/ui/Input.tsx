import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";
import clsx from "clsx";
import styles from "./forms.module.css";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; ref?: Ref<HTMLInputElement> };
export function Input({ invalid, className, ref, ...rest }: InputProps) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={clsx(styles.field, invalid && styles.invalid, className)} {...rest} />;
}

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; ref?: Ref<HTMLTextAreaElement> };
export function TextArea({ invalid, className, ref, ...rest }: TextAreaProps) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={clsx(styles.field, invalid && styles.invalid, className)} {...rest} />;
}
