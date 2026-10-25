import { Ban } from "lucide-react";
import { flint } from "../../../lib/api";
import { useFlintQuery } from "../../../lib/hooks";
import { formatFullDate } from "../../../lib/format";
import { Button, useToast } from "../../../ui";
import { SectionPage } from "../fields";
import { errorText } from "../useAccounts";
import styles from "../settings.module.css";

export function BlockedSection() {
  const toast = useToast();
  const blocked = useFlintQuery((api) => api.listBlocked(), [], { mail: false });
  const unblock = async (pattern: string) => {
    try {
      await flint.unblockSender(pattern);
      blocked.refetch();
    } catch (err) {
      toast.show({ message: errorText(err, "Couldn't unblock that sender. Try again."), level: "error" });
    }
  };
  const items = blocked.data ?? [];
  return (
    <SectionPage title="Blocked" description="Mail from these senders goes to Blocked and never reaches the inbox.">
      {!blocked.loading && items.length === 0 ? (
        <p className={styles.muted} style={{ padding: "var(--s-5) 0" }}>No blocked senders. Block a sender from the message menu.</p>
      ) : (
        items.map((b) => (
          <div key={b.pattern} className={styles.row}>
            <Ban size={16} strokeWidth={1.5} color="var(--fg-3)" aria-hidden />
            <div className={styles.rowGrow}>
              <div className={styles.rowTitle}>{b.pattern}</div>
              <div className={`${styles.rowSub} ${styles.mono}`}>Blocked {formatFullDate(b.createdAt)}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void unblock(b.pattern)}>Unblock</Button>
          </div>
        ))
      )}
    </SectionPage>
  );
}
