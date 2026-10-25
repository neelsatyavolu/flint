import type { JSX } from "react";
import { Bell, BellRing, Clock, Eye, EyeOff, FileText, Minus, MoreHorizontal, Paperclip, SendHorizontal, Sparkles, X } from "lucide-react";
import type { Signature, Template } from "@flint/core";
import { formatPresetTime } from "../../lib/time";
import { DateTimePicker } from "../../ui/DateTimePicker";
import { IconButton } from "../../ui/IconButton";
import { Menu, type MenuItem } from "../../ui/Menu";
import { FromSelector } from "./FromSelector";
import { ReminderPicker } from "./ReminderPicker";
import { signaturesForAccount } from "./signature";
import type { Fields, FromOption } from "./useComposerSession";
import type { SaveState } from "./autosave";
import styles from "./Composer.module.css";

export const SAVE_LABEL: Record<SaveState, string> = { idle: "", saving: "Saving", saved: "Saved", error: "Couldn't save" };

export const RECEIPTS_ON = "Read receipts on: Flint tells you when each recipient opens this";
export const RECEIPTS_OFF = "Read receipts off: Flint won't track opens for this message";

type Props = {
  fields: Fields;
  saveState: SaveState;
  fromOptions: FromOption[];
  templates: Template[];
  signatures: Signature[];
  receiptsAvailable: boolean;
  aiOpen: boolean;
  sending: boolean;
  onMinimize: () => void;
  onClose: () => void;
  onToggleAi: () => void;
  onAttach: () => void;
  onTemplate: (t: Template) => void;
  onRemind: (at: number | null) => void;
  onSendLater: (at: number) => void;
  onToggleTrack: () => void;
  onFrom: (o: FromOption) => void;
  onSignature: (s: Signature | null) => void;
  onDiscard: () => void;
  onSend: () => void;
};

/** Composer top bar: close and minimize on the left, tools, From and Send on the right. */
export function ComposerBar(p: Props): JSX.Element {
  const { fields } = p;
  const now = Date.now();
  const templateItems: MenuItem[] = p.templates.length
    ? [{ type: "label", label: "Insert template" }, ...p.templates.map((t) => ({ id: `t${t.id}`, label: t.name, onSelect: () => p.onTemplate(t) }))]
    : [{ id: "none", label: "No templates yet", disabled: true, onSelect: () => undefined }];
  const sigs = signaturesForAccount(p.signatures, fields.accountId);
  const moreItems: MenuItem[] = [
    { type: "label", label: "Signature" },
    { id: "sig-none", label: "None", checked: fields.signatureId === null, onSelect: () => p.onSignature(null) },
    ...sigs.map((s) => ({ id: `sig${s.id}`, label: s.name, checked: fields.signatureId === s.id, onSelect: () => p.onSignature(s) })),
    { type: "separator" },
    { id: "discard", label: "Discard draft", danger: true, onSelect: p.onDiscard },
  ];
  const remindLabel = fields.remindAt ? `Reminder: ${formatPresetTime(fields.remindAt, now)}` : "Remind me if no reply";

  return (
    <div className={`${styles.bar} drag`}>
      <div className={`${styles.group} no-drag`}>
        <IconButton label="Close and save draft" onClick={p.onClose}><X size={18} strokeWidth={1.5} /></IconButton>
        <IconButton label="Minimize" onClick={p.onMinimize}><Minus size={18} strokeWidth={1.5} /></IconButton>
        <span className={`t-data ${styles.saved}`} role="status" aria-live="polite">{SAVE_LABEL[p.saveState]}</span>
      </div>
      <div className={`${styles.group} no-drag`}>
        <IconButton label="+AI" tone="accent" pressed={p.aiOpen} onClick={p.onToggleAi}><Sparkles size={18} strokeWidth={1.5} /></IconButton>
        <IconButton label="Attach files" onClick={p.onAttach}><Paperclip size={18} strokeWidth={1.5} /></IconButton>
        <Menu items={templateItems} placement="bottom-end" trigger={<IconButton label="Templates"><FileText size={18} strokeWidth={1.5} /></IconButton>} />
        <ReminderPicker
          value={fields.remindAt}
          onPick={p.onRemind}
          trigger={<IconButton label={remindLabel} pressed={fields.remindAt !== null}>{fields.remindAt ? <BellRing size={18} strokeWidth={1.5} /> : <Bell size={18} strokeWidth={1.5} />}</IconButton>}
        />
        <DateTimePicker title="Send later" onPick={p.onSendLater} trigger={<IconButton label="Send later"><Clock size={18} strokeWidth={1.5} /></IconButton>} />
        {p.receiptsAvailable ? (
          <IconButton label={fields.track ? RECEIPTS_ON : RECEIPTS_OFF} pressed={fields.track} onClick={p.onToggleTrack}>
            {fields.track ? <Eye size={18} strokeWidth={1.5} /> : <EyeOff size={18} strokeWidth={1.5} />}
          </IconButton>
        ) : null}
        <Menu items={moreItems} placement="bottom-end" trigger={<IconButton label="More"><MoreHorizontal size={18} strokeWidth={1.5} /></IconButton>} />
        <span className={styles.sep} aria-hidden />
        <FromSelector value={fields.from} options={p.fromOptions} onChange={p.onFrom} />
        <IconButton label="Send" shortcut="mod+Enter" size={32} tone="accent" filled disabled={p.sending} onClick={p.onSend}>
          <SendHorizontal size={18} strokeWidth={1.5} />
        </IconButton>
      </div>
    </div>
  );
}
