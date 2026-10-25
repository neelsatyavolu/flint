import { CATEGORIZER_VERSION } from "../categorize";
import { logger } from "../log";
import type { ServiceContext } from "./context";

const log = logger("service.recategorize");
/** kv_cache key (no TTL) holding the categorizer version the stored mail was last labelled with. */
export const CATEGORIZER_VERSION_KEY = "categorizerVersion";
/** kv_cache key for the categorizer version whose headers were last re-fetched from the server. */
export const HEADERS_VERSION_KEY = "categorizerHeadersVersion";
/** How far back header refresh reaches: the inbox people actually look at. */
const HEADER_REFRESH_DAYS = 90;

/** Re-labels existing mail once when categorize() has changed since the last run. Returns how many messages changed. */
export function recategorizeIfStale(ctx: ServiceContext): number {
  const stored = Number(ctx.store.kvGet(CATEGORIZER_VERSION_KEY, ctx.now()) ?? 0);
  if (stored >= CATEGORIZER_VERSION) return 0;
  const changed = ctx.store.transaction(() => ctx.store.recategorizeAll());
  ctx.store.kvSet(CATEGORIZER_VERSION_KEY, String(CATEGORIZER_VERSION), undefined, ctx.now());
  log.info("re-categorized stored mail", { changed, version: CATEGORIZER_VERSION });
  if (changed > 0) for (const a of ctx.store.listAccounts()) ctx.emit({ type: "mail_changed", accountId: a.id, threadIds: [] });
  return changed;
}

/**
 * Once per categorizer version: re-fetch the categorization headers of recent inbox mail (older syncs stored fewer),
 * then re-label. Runs in the background after start; accounts that fail are retried on the next start.
 */
export async function refreshHeadersIfStale(ctx: ServiceContext): Promise<number> {
  const stored = Number(ctx.store.kvGet(HEADERS_VERSION_KEY, ctx.now()) ?? 0);
  if (stored >= CATEGORIZER_VERSION) return 0;
  const since = ctx.now() - HEADER_REFRESH_DAYS * 24 * 60 * 60 * 1000;
  let updated = 0;
  let failed = false;
  for (const account of ctx.store.listAccounts()) {
    if (!account.enabled) continue;
    const targets = ctx.store.headerRefreshTargets(account.id, since);
    if (targets.length === 0) continue;
    try {
      updated += await ctx.syncs.get(account.id).refreshHeaders(targets);
    } catch (error) {
      failed = true;
      log.warn("could not refresh headers for categorization", { account: account.id, reason: (error as Error).message });
    }
  }
  const changed = ctx.store.transaction(() => ctx.store.recategorizeAll());
  if (!failed) ctx.store.kvSet(HEADERS_VERSION_KEY, String(CATEGORIZER_VERSION), undefined, ctx.now());
  log.info("refreshed headers and re-categorized", { updated, changed, version: CATEGORIZER_VERSION });
  if (changed > 0) for (const a of ctx.store.listAccounts()) ctx.emit({ type: "mail_changed", accountId: a.id, threadIds: [] });
  return changed;
}
