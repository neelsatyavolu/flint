import { RefreshCw, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { flint } from "../lib/api";
import { Button, IconButton, Popover } from "../ui";
import { type SyncSummary } from "../state/sidebarModel";
import { useSignInAgain } from "./AuthBanner";
import styles from "./Sidebar.module.css";

/** Sync button. Spins while any account syncs; with problems it opens a short list of what failed. */
export function SyncButton({ sync }: { sync: SyncSummary }) {
  const signInAgain = useSignInAgain();
  const icon = sync.problems.length ? <TriangleAlert size={16} strokeWidth={1.5} color="var(--warn)" /> : <RefreshCw size={16} strokeWidth={1.5} className={clsx(sync.syncing && styles.spin)} />;
  const button = (
    <IconButton label={sync.problems.length ? "Sync problems" : sync.syncing ? "Syncing" : "Sync now"} className="no-drag" onClick={sync.problems.length ? undefined : () => void flint.syncNow()}>
      {icon}
    </IconButton>
  );
  if (sync.problems.length === 0) return button;
  return (
    <Popover trigger={button} placement="bottom-start" label="Sync problems">
      {(close) => (
        <div className={styles.problems}>
          {sync.problems.map((p) => (
            <div key={p.accountId} className={styles.problem}>
              <div className={styles.problemText}>
                <span className="t-strong">{p.email}</span>
                <span className={styles.problemMsg}>{p.message}</span>
              </div>
              {p.needsSignIn ? (
                <Button size="sm" variant="ghost" onClick={() => { signInAgain(p.accountId); close(); }}>Sign in again</Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => { void flint.syncNow(p.accountId); close(); }}>Retry</Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}
