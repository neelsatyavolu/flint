import { useMemo, useState, type JSX, type ReactElement, type Ref } from "react";
import { CalendarDays } from "lucide-react";
import { formatPresetTime, parseLocalInput, toLocalInput } from "../../lib/time";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Popover } from "../../ui/Popover";
import { SectionLabel } from "../../ui/SectionLabel";
import panel from "../../ui/DateTimePicker.module.css";
import { reminderPresets } from "./reminders";

type Props = {
  trigger: ReactElement<{ ref?: Ref<unknown> } & Record<string, unknown>>;
  value: number | null;
  onPick: (at: number | null) => void;
  now?: number;
};

/** "Remind me if no reply in": 1 day, 3 days, 1 week or a custom time. Reuses the send-later picker styling. */
export function ReminderPicker({ trigger, value, onPick, now = Date.now() }: Props): JSX.Element {
  return (
    <Popover trigger={trigger} label="Reminder" placement="bottom-start">
      {(close) => <ReminderPanel value={value} now={now} onPick={(at) => { onPick(at); close(); }} />}
    </Popover>
  );
}

export function ReminderPanel({ value, onPick, now }: { value: number | null; onPick: (at: number | null) => void; now: number }): JSX.Element {
  const presets = useMemo(() => reminderPresets(now), [now]);
  const [custom, setCustom] = useState(false);
  const [input, setInput] = useState(() => toLocalInput(presets[1]!.at));
  const at = parseLocalInput(input);
  return (
    <div className={panel.panel}>
      <SectionLabel className={panel.title}>Remind me if no reply in</SectionLabel>
      <div className={panel.list}>
        {presets.map((p) => (
          <button key={p.id} type="button" className={panel.row} onClick={() => onPick(p.at)}>
            <span className={panel.rowLabel}>{p.label}</span>
            <span className="t-data" style={{ color: "var(--fg-3)" }}>{formatPresetTime(p.at, now)}</span>
          </button>
        ))}
        <button type="button" className={panel.row} aria-expanded={custom} onClick={() => setCustom((c) => !c)}>
          <span className={panel.rowLabel}><CalendarDays size={14} strokeWidth={1.5} /> Custom</span>
        </button>
        {value !== null ? (
          <button type="button" className={panel.row} onClick={() => onPick(null)}>
            <span className={panel.rowLabel}>No reminder</span>
            <span className="t-data" style={{ color: "var(--fg-3)" }}>{formatPresetTime(value, now)}</span>
          </button>
        ) : null}
      </div>
      {custom ? (
        <form className={panel.custom} onSubmit={(e) => { e.preventDefault(); if (at !== null && at > now) onPick(at); }}>
          <Input type="datetime-local" aria-label="Reminder time" value={input} min={toLocalInput(now)} onChange={(e) => setInput(e.target.value)} autoFocus />
          <Button type="submit" variant="primary" size="sm" disabled={at === null || at <= now}>Set</Button>
        </form>
      ) : null}
    </div>
  );
}
