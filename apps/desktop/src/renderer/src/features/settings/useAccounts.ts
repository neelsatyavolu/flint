import { useCallback } from "react";
import type { Account, AccountId, SyncStatus } from "@flint/core";
import { flint } from "../../lib/api";
import { useFlintQuery } from "../../lib/hooks";
import { useToast } from "../../ui";

export type AccountPatch = Partial<Pick<Account, "name" | "color" | "sortOrder" | "enabled" | "aliases">>;

export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Accounts plus their sync state, live. */
export function useAccounts() {
  const accounts = useFlintQuery((api) => api.listAccounts(), [], { refetchOn: ["sync"] });
  const sync = useFlintQuery((api) => api.getSyncStatus(), [], { refetchOn: ["sync"] });
  const byAccount = new Map<AccountId, SyncStatus>((sync.data ?? []).map((s) => [s.accountId, s]));
  return { accounts: accounts.data, loading: accounts.loading, error: accounts.error, refetch: accounts.refetch, syncOf: (id: AccountId) => byAccount.get(id) };
}

/** Saves an account change and reports a failure as a toast. */
export function useUpdateAccount(): (id: AccountId, patch: AccountPatch) => Promise<boolean> {
  const toast = useToast();
  return useCallback(
    async (id, patch) => {
      try {
        await flint.updateAccount(id, patch);
        return true;
      } catch (err) {
        toast.show({ message: errorText(err, "Couldn't update the account. Try again."), level: "error" });
        return false;
      }
    },
    [toast],
  );
}
