import type { JSX } from "react";
import { MoreHorizontal, SendHorizontal } from "lucide-react";
import type { Signature, Template } from "@flint/core";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { Menu } from "../../ui/Menu";
import { ComposerTools, moreMenuItems, SAVE_LABEL } from "./ComposerBar";
import { FromSelector } from "./FromSelector";
import type { SaveState } from "./autosave";
import type { Fields, FromOption } from "./useComposerSession";
import styles from "./InlineReplyDock.module.css";

type Props = {
  fields: Fields;
  saveState: SaveState;
  fromOptions: FromOption[];
  templates: Template[];
  signatures: Signature[];
  receiptsBlockedReason: string | null;
  aiOpen: boolean;
  sending: boolean;
  onToggleAi: () => void;
  onAttach: () => void;
  onTemplate: (t: Template) => void;
  onRemind: (at: number | null) => void;
  onSendLater: (at: number) => void;
  sendLaterOpen?: boolean;
  onSendLaterOpenChange?: (open: boolean) => void;
  onToggleTrack: () => void;
  onFrom: (o: FromOption) => void;
  onSignature: (s: Signature | null) => void;
  onDiscard: () => void;
  onSend: () => void;
};

/** Bottom toolbar of the docked reply: tools at the left, From and Send at the right. */
export function ReplyToolbar(p: Props): JSX.Element {
  const moreItems = moreMenuItems({ fields: p.fields, signatures: p.signatures, onSignature: p.onSignature, onDiscard: p.onDiscard });
  return (
    <div className={styles.toolbar}>
      <div className={styles.tools}>
        <ComposerTools
          fields={p.fields}
          templates={p.templates}
          receiptsBlockedReason={p.receiptsBlockedReason}
          aiOpen={p.aiOpen}
          placement="top-start"
          onToggleAi={p.onToggleAi}
          onAttach={p.onAttach}
          onTemplate={p.onTemplate}
          onRemind={p.onRemind}
          onSendLater={p.onSendLater}
          sendLaterOpen={p.sendLaterOpen}
          onSendLaterOpenChange={p.onSendLaterOpenChange}
          onToggleTrack={p.onToggleTrack}
        />
        <Menu items={moreItems} placement="top-start" trigger={<IconButton label="More"><MoreHorizontal size={18} strokeWidth={1.5} /></IconButton>} />
        <span className={`t-data ${styles.saved}`} role="status" aria-live="polite">{SAVE_LABEL[p.saveState]}</span>
      </div>
      <div className={styles.send}>
        <FromSelector value={p.fields.from} options={p.fromOptions} accountId={p.fields.accountId} onChange={p.onFrom} />
        <Button variant="primary" size="sm" icon={<SendHorizontal size={16} strokeWidth={1.5} />} disabled={p.sending} onClick={p.onSend}>Send</Button>
      </div>
    </div>
  );
}
