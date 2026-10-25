import type { FlintApi } from "../api";
import { logger } from "../log";
import { FlintError } from "../types";
import type { ServiceContext } from "./context";

const log = logger("service.sync");

export type SyncApi = Pick<FlintApi, "syncNow" | "getSyncStatus">;

const asFlintError = (error: unknown): FlintError =>
  error instanceof FlintError ? error : new FlintError("network", "Sync failed. Check your connection and try again.");

export function syncApi(ctx: ServiceContext): SyncApi {
  return {
    async syncNow(accountId) {
      const accounts = accountId
        ? [ctx.store.requireAccount(accountId)]
        : ctx.store.listAccounts().filter((a) => a.enabled);
      const results = await Promise.allSettled(accounts.map((a) => ctx.syncs.get(a.id).syncNow()));
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      for (const f of failures) log.warn("sync failed", { reason: (f.reason as Error).message });
      // One account failing does not fail a sync of all; every account failing, or the one asked for, does.
      if (failures.length > 0 && failures.length === results.length) throw asFlintError(failures[0]!.reason);
    },

    async getSyncStatus() {
      return ctx.syncs.statuses();
    },
  };
}
