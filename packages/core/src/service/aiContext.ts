import type { Platform } from "../platform";
import type { AiContext } from "../ai/ports";
import { htmlToText } from "../sanitize";
import type { Store } from "../store";
import { aiThreadBriefs, rankedThreadSearch } from "../store/aiSearch";
import type { Settings } from "../types";
import { ensureBodies } from "./bodies";
import type { SyncManager } from "./syncManager";

export type AiContextDeps = {
  store: Store;
  syncs: SyncManager;
  platform: Platform;
  getSettings: () => Settings;
  now: () => number;
  fetch?: typeof fetch;
};

const NOBODY = { name: "", address: "" };

/** Gives the AI module read access to mail through the store, without it knowing about the store. */
export function buildAiContext(d: AiContextDeps): AiContext {
  const { store } = d;
  return {
    getSettings: d.getSettings,
    secrets: d.platform.secrets,
    now: d.now,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    ...(d.fetch ? { fetch: d.fetch } : {}),
    async getThreadForAi(threadId) {
      const first = store.getThreadRows(threadId);
      if (!first) return null;
      await ensureBodies(store, d.syncs, first.messages.map((m) => m.id));
      const rows = store.getThreadRows(threadId) ?? first;
      const account = store.getAccount(rows.accountId);
      const addresses = account ? [...new Set([account.email, ...account.aliases])] : [];
      return {
        subject: rows.subject,
        ...(account ? { self: { name: account.name, addresses } } : {}),
        messages: rows.messages.filter((m) => !m.draft).map((m) => ({
          fromMe: m.isFromMe,
          from: m.from[0] ?? NOBODY,
          to: m.to,
          date: m.date,
          text: m.text ?? (m.rawHtml ? htmlToText(m.rawHtml) : m.snippet),
        })),
      };
    },
    async searchForAi(query, limit) {
      const page = store.listThreads({ view: "search", search: query, limit });
      return page.items.map((t) => ({
        threadId: t.id, subject: t.subject, date: t.lastDate, from: t.participants.at(-1) ?? NOBODY, snippet: t.snippet,
      }));
    },
    async rankedSearchForAi(query) {
      return rankedThreadSearch(store, query, d.now());
    },
    async listThreadsForAi(kind, limit) {
      return aiThreadBriefs(store, kind, limit, d.now());
    },
    cacheGet: (key) => store.kvGet(key, d.now()),
    cacheSet: (key, value, ttlMs) => store.kvSet(key, value, ttlMs, d.now()),
  };
}
