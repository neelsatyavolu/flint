import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { Account } from "@flint/core";
import { flint } from "../../../lib/api";
import { Avatar, Button, Dialog, Toggle, useToast } from "../../../ui";
import { AddAccount } from "../../onboarding/AddAccount";
import { AccountDetail } from "../accounts/AccountDetail";
import { describeStatus } from "../accounts/accountStatus";
import { SectionPage } from "../fields";
import { errorText, useAccounts, useUpdateAccount } from "../useAccounts";
import styles from "../settings.module.css";

export function AccountsSection() {
  const toast = useToast();
  const { accounts, loading, refetch, syncOf } = useAccounts();
  const update = useUpdateAccount();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [reauth, setReauth] = useState<Account | null>(null);

  const patch = async (id: string, p: Parameters<typeof update>[1]) => {
    if (await update(id, p)) refetch();
  };

  const remove = async (id: string) => {
    try {
      await flint.removeAccount(id);
      setOpen(null);
      refetch();
    } catch (err) {
      toast.show({ message: errorText(err, "Couldn't remove the account. Try again."), level: "error" });
    }
  };

  const signIn = async (a: Account) => {
    if (a.authKind === "oauth_google") {
      try {
        await flint.addGoogleAccount();
        refetch();
      } catch (err) {
        toast.show({ message: errorText(err, "Google sign-in didn't finish. Try again."), level: "error" });
      }
    } else {
      setReauth(a);
    }
  };

  const list = accounts ?? [];
  return (
    <SectionPage title="Accounts" description="Mail accounts Flint syncs. Changes apply at once.">
      <div className={styles.inline} style={{ justifyContent: "flex-end", marginTop: "var(--s-2)" }}>
        <Button variant="primary" icon={<Plus size={14} strokeWidth={1.5} />} onClick={() => setAdding(true)}>Add account</Button>
      </div>
      <div style={{ marginTop: "var(--s-2)", borderTop: "1px solid var(--line)" }}>
        {list.map((a) => {
          const status = describeStatus(syncOf(a.id), a.enabled);
          const isOpen = open === a.id;
          return (
            <div key={a.id} className={styles.hair}>
              <div className={styles.row} style={{ borderBottom: 0 }}>
                <button
                  type="button"
                  className={styles.rowGrow}
                  aria-expanded={isOpen}
                  aria-label={`${a.email}, ${isOpen ? "hide" : "show"} details`}
                  onClick={() => setOpen(isOpen ? null : a.id)}
                  style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", border: 0, background: "transparent", color: "inherit", textAlign: "left", padding: 0 }}
                >
                  {isOpen ? <ChevronDown size={14} strokeWidth={1.5} color="var(--fg-3)" aria-hidden /> : <ChevronRight size={14} strokeWidth={1.5} color="var(--fg-3)" aria-hidden />}
                  <Avatar address={a.email} name={a.name} accountId={a.id} size={32} />
                  <span className={styles.rowGrow}>
                    <span className={styles.rowTitle} style={{ display: "block" }}>{a.email}</span>
                    <span className={`${styles.mono} ${styles[status.tone]}`} style={{ display: "block" }}>{a.name} · {status.text}</span>
                  </span>
                  <span className={styles.dot} style={{ background: a.color ?? "var(--line-strong)" }} aria-hidden />
                </button>
                <span className={`t-data ${styles.muted}`} aria-hidden>Sync</span>
                <Toggle checked={a.enabled} label={`Sync ${a.email}`} onChange={(enabled) => void patch(a.id, { enabled })} />
              </div>
              {isOpen ? (
                <AccountDetail
                  account={a}
                  sync={syncOf(a.id)}
                  onPatch={(p) => void patch(a.id, p)}
                  onRemove={() => remove(a.id)}
                  onSignIn={() => signIn(a)}
                  onChanged={refetch}
                />
              ) : null}
            </div>
          );
        })}
        {!loading && list.length === 0 ? <p className={styles.muted} style={{ padding: "var(--s-5) 0" }}>No accounts yet. Add one to start syncing.</p> : null}
      </div>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add account" width={520}>
        <AddAccount onDone={() => { setAdding(false); refetch(); }} onCancel={() => setAdding(false)} />
      </Dialog>
      <Dialog open={reauth !== null} onClose={() => setReauth(null)} title="Sign in again" width={520}>
        {reauth ? <AddAccount reauth={reauth} onDone={() => { setReauth(null); refetch(); }} onCancel={() => setReauth(null)} /> : null}
      </Dialog>
    </SectionPage>
  );
}
