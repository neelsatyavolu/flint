import { useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type Ref } from "react";
import { CalendarDays } from "lucide-react";
import { formatPresetTime, parseLocalInput, resolvePresets, toLocalInput } from "../lib/time";
import { Button } from "./Button";
import { Input } from "./Input";
import { Popover } from "./Popover";
import { SectionLabel } from "./SectionLabel";
import styles from "./DateTimePicker.module.css";

type PanelProps = {
  title: string;
  onPick: (at: number) => void;
  /** Injected for tests and previews. */
  now?: number;
};

/** Preset list plus a custom date and time form. Used by snooze, send later and reminders. */
export function DateTimePanel({ title, onPick, now = Date.now() }: PanelProps) {
  const presets = useMemo(() => resolvePresets(now), [now]);
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState(() => toLocalInput(presets.find((p) => p.id === "tomorrow")?.at ?? now + 86400_000));
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
    e.preventDefault();
  };

  const at = parseLocalInput(value);
  return (
    <div className={styles.panel} onKeyDown={onKeyDown}>
      <SectionLabel className={styles.title}>{title}</SectionLabel>
      <div ref={listRef} className={styles.list}>
        {presets.map((p) => (
          <button key={p.id} type="button" className={styles.row} onClick={() => onPick(p.at)}>
            <span className={styles.rowLabel}>{p.label}</span>
            <span className="t-data" style={{ color: "var(--fg-3)" }}>{formatPresetTime(p.at, now)}</span>
          </button>
        ))}
        <button type="button" className={styles.row} aria-expanded={custom} onClick={() => setCustom((c) => !c)}>
          <span className={styles.rowLabel}><CalendarDays size={14} strokeWidth={1.5} /> Pick date &amp; time</span>
        </button>
      </div>
      {custom ? (
        <form
          className={styles.custom}
          onSubmit={(e) => {
            e.preventDefault();
            if (at !== null && at > now) onPick(at);
          }}
        >
          <Input type="datetime-local" aria-label="Date and time" value={value} min={toLocalInput(now)} onChange={(e) => setValue(e.target.value)} autoFocus />
          <Button type="submit" variant="primary" size="sm" disabled={at === null || at <= now}>Set</Button>
        </form>
      ) : null}
    </div>
  );
}

/** Popover version: click `trigger`, choose a preset or a custom time; the popover closes after a pick. */
export function DateTimePicker({ trigger, title = "Snooze until", onPick, now }: { trigger: ReactElement<{ ref?: Ref<unknown> } & Record<string, unknown>>; title?: string; onPick: (at: number) => void; now?: number }) {
  return (
    <Popover trigger={trigger} label={title} placement="bottom-start">
      {(close) => (
        <DateTimePanel
          title={title}
          now={now}
          onPick={(at) => {
            onPick(at);
            close();
          }}
        />
      )}
    </Popover>
  );
}
