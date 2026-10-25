import { z } from "zod";
import type { FlintApi } from "../api";
import type { Category, Rule, ThreadId } from "../types";
import type { ServiceContext } from "./context";
import { UNDO_TTL_MS } from "./undo";

const threadIds = z.array(z.number().int().positive()).min(1).max(5000);
const categorySchema = z.enum(["people", "notifications", "newsletters"]);
const MAX_SENDERS = 25;
const SENDER_THREAD_LIMIT = 200;

/** The rule that sends one sender to a category: from equals the address, nothing else, and a single category action. */
const isSenderRule = (r: Rule, address: string): boolean =>
  r.accountId === null && r.conditions.length === 1 && r.actions.length === 1 && r.actions[0]!.type === "category" &&
  r.conditions[0]!.field === "from" && r.conditions[0]!.op === "equals" && r.conditions[0]!.value.toLowerCase() === address;

/**
 * Moving mail between People, Notifications and Newsletters. The category is stored on the messages with source
 * "manual", which neither the heuristics nor a later re-categorize overrides. "Always for this sender" is a rule
 * (from equals the address, action category) so mail that arrives later is filed the same way.
 */
export function categoriesApi(ctx: ServiceContext) {
  const { store } = ctx;
  /** Extra undo work (removing or restoring a sender rule) by undo token. Entries expire with the token itself. */
  const sideEffects = new Map<string, { run: () => void; expiresAt: number }>();
  const prune = (): void => {
    const now = ctx.now();
    for (const [token, entry] of sideEffects) if (entry.expiresAt <= now) sideEffects.delete(token);
  };

  /** The sender of the first received message in each thread, lowercased and unique. */
  function sendersOf(ids: ThreadId[]): string[] {
    const out = new Set<string>();
    for (const id of ids) {
      const rows = store.getThreadRows(id);
      const first = rows?.messages.find((m) => !m.isFromMe && !m.draft && m.from[0]);
      if (first) out.add(first.from[0]!.address.toLowerCase());
    }
    return [...out];
  }

  /** Inbox threads that also involve these senders, so "always" moves what is already there too. */
  function threadsFrom(senders: string[]): ThreadId[] {
    const out = new Set<ThreadId>();
    for (const address of senders) {
      const page = store.listThreads({ view: "search", search: `in:inbox from:${address}`, limit: SENDER_THREAD_LIMIT }, ctx.now());
      for (const t of page.items) if (t.participants.some((p) => p.address.toLowerCase() === address)) out.add(t.id);
    }
    return [...out];
  }

  /** Creates or updates the rule for each sender. Returns a function that puts the rules back as they were. */
  function rememberSenders(senders: string[], category: Category): () => void {
    const undo: (() => void)[] = [];
    const rules = store.listRules();
    let sortOrder = rules.reduce((m, r) => Math.max(m, r.sortOrder), 0);
    for (const address of senders) {
      const existing = rules.find((r) => isSenderRule(r, address));
      const action = { type: "category" as const, category };
      if (existing) {
        const before = existing;
        store.saveRule({ ...existing, enabled: true, actions: [action] });
        undo.push(() => void store.saveRule(before));
      } else {
        sortOrder += 1;
        const saved = store.saveRule({
          name: `Mail from ${address}`, enabled: true, accountId: null, match: "all",
          conditions: [{ field: "from", op: "equals", value: address }], actions: [action], sortOrder,
        });
        undo.push(() => store.deleteRule(saved.id));
      }
    }
    return () => { for (const u of undo.reverse()) u(); };
  }

  return {
    api: {
      async setCategory(ids, category, opts) {
        const requested = threadIds.parse(ids);
        const target = categorySchema.parse(category);
        const senders = opts?.sender ? sendersOf(requested).slice(0, MAX_SENDERS) : [];
        const all = [...new Set([...requested, ...threadsFrom(senders)])];
        const out = await ctx.optimistic.run({
          label: "change the category",
          local: () => {
            const snapshot = store.snapshotThreads(all);
            store.pinCategory(all, target, "manual");
            return { snapshot, locations: [] };
          },
        });
        if (senders.length > 0) {
          const restore = rememberSenders(senders, target);
          prune();
          sideEffects.set(out.undoToken, { run: restore, expiresAt: ctx.now() + UNDO_TTL_MS });
        }
        return out;
      },
    } satisfies Pick<FlintApi, "setCategory">,
    /** Runs (once) the extra undo work registered for this token. Called after the snapshot restore succeeded. */
    onUndo(token: string): void {
      const entry = sideEffects.get(token);
      sideEffects.delete(token);
      entry?.run();
    },
    /** Drops the extra undo work for a token whose undo failed (expired or used), so nothing lingers. */
    forget(token: string): void {
      sideEffects.delete(token);
    },
  };
}
