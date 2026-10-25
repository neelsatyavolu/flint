import type { JSX } from "react";
import { Maximize2, X } from "lucide-react";
import { IconButton } from "../../ui/IconButton";
import styles from "./InlineReplyDock.module.css";

type Props = { title: string; onExpand: () => void; onClose: () => void };

/** Title of the docked reply with expand and close at the right. There is no separate composer window, so there is no pop-out. */
export function ReplyHeader({ title, onExpand, onClose }: Props): JSX.Element {
  return (
    <div className={styles.head}>
      <h3 className={styles.title} title={title}>{title}</h3>
      <div className={styles.headActions}>
        <IconButton label="Open in full composer" size={24} onClick={onExpand}><Maximize2 size={14} strokeWidth={1.5} /></IconButton>
        <IconButton label="Close and keep draft" shortcut="esc" size={24} onClick={onClose}><X size={16} strokeWidth={1.5} /></IconButton>
      </div>
    </div>
  );
}
