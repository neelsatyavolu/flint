import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Input, SettingsRow, TextArea, Toggle, Select } from "../../ui";
import styles from "./settings.module.css";

export function SectionPage({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <header className={styles.pageHead}>
        <h2 className="t-title">{title}</h2>
        {description ? <p className={styles.pageDesc}>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function ToggleRow({ icon, title, label, description, checked, onChange, disabled }: { icon?: ReactNode; title: string; label?: string; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <SettingsRow icon={icon} title={title} description={description}>
      <Toggle checked={checked} onChange={onChange} label={label ?? title} disabled={disabled} />
    </SettingsRow>
  );
}

export type Choice<T extends string | number> = { value: T; label: string };

export function SelectRow<T extends string | number>({ icon, title, description, value, choices, onChange, disabled }: { icon?: ReactNode; title: string; description?: ReactNode; value: T; choices: Choice<T>[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <SettingsRow icon={icon} title={title} description={description}>
      <ChoiceSelect label={title} value={value} choices={choices} onChange={onChange} disabled={disabled} />
    </SettingsRow>
  );
}

export function ChoiceSelect<T extends string | number>({ label, value, choices, onChange, disabled }: { label: string; value: T; choices: Choice<T>[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <Select
      aria-label={label}
      value={String(value)}
      disabled={disabled}
      onChange={(e) => {
        const hit = choices.find((c) => String(c.value) === e.target.value);
        if (hit) onChange(hit.value);
      }}
    >
      {choices.map((c) => (
        <option key={String(c.value)} value={String(c.value)}>{c.label}</option>
      ))}
    </Select>
  );
}

export function LinkRow({ icon, title, description, onClick }: { icon?: ReactNode; title: string; description?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={styles.rowBtn} onClick={onClick}>
      {icon ? <span style={{ color: "var(--accent)", display: "inline-flex", width: 20 }} aria-hidden>{icon}</span> : null}
      <span className={styles.rowGrow}>
        <span className={styles.rowTitle} style={{ display: "block", font: "600 var(--text-setting) / 20px var(--font-ui)" }}>{title}</span>
        {description ? <span className={styles.muted} style={{ display: "block", marginTop: 2 }}>{description}</span> : null}
      </span>
      <ChevronRight size={16} strokeWidth={1.5} color="var(--fg-3)" aria-hidden />
    </button>
  );
}

/**
 * Text field that commits after the user pauses, on blur and on unmount.
 * Follows outside changes while the field is not being edited.
 */
export function DebouncedText({ value, onCommit, multiline, delay = 500, label, invalid, ...rest }: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  delay?: number;
  label: string;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
  rows?: number;
}) {
  const [text, setText] = useState(value);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ text, onCommit });
  latest.current = { text, onCommit };

  useEffect(() => {
    if (!dirty.current) setText(value);
  }, [value]);

  const flush = () => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    latest.current.onCommit(latest.current.text);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: string) => {
    dirty.current = true;
    latest.current = { ...latest.current, text: next };
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };

  return multiline ? (
    <TextArea aria-label={label} value={text} invalid={invalid} onChange={(e) => change(e.target.value)} onBlur={flush} {...rest} />
  ) : (
    <Input aria-label={label} value={text} invalid={invalid} onChange={(e) => change(e.target.value)} onBlur={flush} {...rest} />
  );
}
