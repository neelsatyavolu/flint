import { useCallback, useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import clsx from "clsx";
import type { Account, AccountId } from "@flint/core";
import { flint } from "../lib/api";
import { errorText } from "../features/settings/useAccounts";
import { useApp } from "../state/AppContext";
import { navStore } from "../state/nav";
import { syncSummary } from "../state/sidebarModel";
import { useToast } from "../ui/Toast";
import styles from "./AppShell.module.css";

/** Settings deep link that opens an account's "Sign in again" dialog (settings sections.ts parses it). */
export function reauthSection(id: AccountId): string {
  return `accounts/${id}/reauth`;
}

/**
 * Starts signing an account in again. Google accounts go straight to the browser sign-in;
 * password accounts open their "Sign in again" dialog in Settings.
 */
export function useSignInAgain(): (accountId: AccountId) => void {
  const { accounts, refreshAccounts } = useApp();
  const toast = useToast();
  return useCallback(
    (accountId) => {
      const account: Account | undefined = accounts.find((a) => a.id === accountId);
      if (account?.authKind !== "oauth_google") {
        navStore.getState().openSettings(reauthSection(accountId));
        return;
      }
      flint.addGoogleAccount().then(
        () => refreshAccounts(),
        (err: unknown) => toast.show({ message: errorText(err, "Google sign-in didn't finish. Try again."), level: "error" }),
      );
    },
    [accounts, refreshAccounts, toast],
  );
}

/** One line per account that needs a new sign-in, above the main content so it stays visible with the sidebar hidden. */
export function AuthBanner() {
  const { sidebar } = useApp();
  const signInAgain = useSignInAgain();
  const expired = useMemo(() => syncSummary(sidebar).problems.filter((p) => p.needsSignIn), [sidebar]);
  if (expired.length === 0) return null;
  return (
    <div className={clsx(styles.authBanner, "drag")} role="status">
      {expired.map((p) => (
        <div key={p.accountId} className={clsx("t-body", styles.authRow)}>
          <TriangleAlert size={14} strokeWidth={1.5} className={styles.authIcon} aria-hidden />
          <span className={styles.authText}>{p.email} needs you to sign in again</span>
          <span className={styles.authDot} aria-hidden>·</span>
          <button type="button" className={clsx(styles.authAction, "no-drag")} aria-label={`Sign in to ${p.email}`} onClick={() => signInAgain(p.accountId)}>Sign in</button>
        </div>
      ))}
    </div>
  );
}
