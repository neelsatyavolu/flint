import { applyCategoryVerdicts, categorizeCandidates } from "../store/aiSearch";
import type { Store } from "../store";
import type { FlintEvent, Settings, ThreadId } from "../types";
import { createAutoCategorizer, type AutoCategorizer, type CategorizerOptions } from "./autoCategorize";
import type { AiEngine } from "./engine";

export type CategorizerWiring = {
  store: Store;
  engine: Pick<AiEngine, "complete">;
  getSettings: () => Settings;
  now: () => number;
  emit: (event: FlintEvent) => void;
  /** Timing overrides (tests). */
  options?: CategorizerOptions;
};

/**
 * Connects the AI categorizer to the store and the engine. The host calls poke() when mail
 * arrives or changes (new_mail, mail_changed) and dispose() on shutdown. Does nothing until
 * settings.ai.autoCategorize is on.
 */
export function createStoreCategorizer(w: CategorizerWiring): AutoCategorizer {
  return createAutoCategorizer({
    getSettings: w.getSettings,
    now: w.now,
    candidates: (limit) => categorizeCandidates(w.store, w.now(), limit),
    apply: (verdicts) => applyCategoryVerdicts(w.store, verdicts),
    cacheGet: (key) => w.store.kvGet(key, w.now()),
    cacheSet: (key, value, ttlMs) => w.store.kvSet(key, value, ttlMs, w.now()),
    complete: (system, user) => w.engine.complete(system, user),
    onChanged: (threadIds: ThreadId[]) => {
      const accounts = new Map<string, ThreadId[]>();
      for (const id of threadIds) {
        const accountId = w.store.getThreadRows(id)?.accountId;
        if (accountId) accounts.set(accountId, [...(accounts.get(accountId) ?? []), id]);
      }
      for (const [accountId, ids] of accounts) w.emit({ type: "mail_changed", accountId, threadIds: ids });
    },
  }, w.options);
}
