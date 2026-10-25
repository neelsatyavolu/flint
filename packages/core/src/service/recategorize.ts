import { CATEGORIZER_VERSION } from "../categorize";
import { logger } from "../log";
import type { ServiceContext } from "./context";

const log = logger("service.recategorize");
/** kv_cache key (no TTL) holding the categorizer version the stored mail was last labelled with. */
export const CATEGORIZER_VERSION_KEY = "categorizerVersion";

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
