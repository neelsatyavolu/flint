import { z } from "zod";
import type { FlintApi } from "../api";
import { logger } from "../log";
import { parseSearch } from "../search";
import { FlintError, type LoadOlderResult, type ServerSearchResult } from "../types";
import type { ServiceContext } from "./context";
import { foldersForQuery } from "./historyFolders";

const log = logger("service.history");

export type HistoryApi = Pick<FlintApi, "loadOlder" | "searchServer">;

const searchText = z.string().max(500);
const accountIdSchema = z.number().int().positive();

const asFlintError = (error: unknown): FlintError =>
  error instanceof FlintError ? error : new FlintError("network", "Couldn't reach the mail server. Check your connection and try again.");

/** Runs one job per account; one account failing does not hide the others, every account failing throws. */
async function eachAccount<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const results = await Promise.allSettled(jobs.map((j) => j()));
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  for (const f of failed) log.warn("server history request failed", { reason: (f.reason as Error).message });
  if (jobs.length > 0 && ok.length === 0) throw asFlintError(failed[0]!.reason);
  return ok;
}

export function historyApi(ctx: ServiceContext): HistoryApi {
  const { store } = ctx;
  return {
    async loadOlder(query): Promise<LoadOlderResult> {
      const groups = foldersForQuery(store, query);
      const parts = await eachAccount(groups.map(({ account, folders }) => () => ctx.syncs.get(account.id).loadOlder(folders.map((f) => f.id))));
      return { loaded: parts.reduce((n, p) => n + p.loaded, 0), hasMore: parts.some((p) => p.hasMore) };
    },

    async searchServer(search, accountId): Promise<ServerSearchResult> {
      searchText.parse(search);
      if (accountId !== undefined) accountIdSchema.parse(accountId);
      const parsed = parseSearch(search);
      const wanted = parsed.account.filter((f) => !f.negated).map((f) => f.value);
      const accounts = store.listAccounts().filter((a) => a.enabled
        && (accountId === undefined || a.id === accountId)
        && (wanted.length === 0 || wanted.includes(a.email.toLowerCase())));
      const parts = await eachAccount(accounts.map((a) => () => ctx.syncs.get(a.id).searchServer(parsed)));
      return { found: parts.reduce((n, p) => n + p.found, 0), added: parts.reduce((n, p) => n + p.added, 0) };
    },
  };
}
