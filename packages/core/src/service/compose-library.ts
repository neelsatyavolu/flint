import { z } from "zod";
import type { FlintApi } from "../api";
import { logger } from "../log";
import { evaluateRules, type RuleMessage } from "../rules";
import { htmlToPlain } from "../store";
import type { ActionResult } from "../store/types";
import { FlintError, type Category, type Rule, type RuleAction, type ThreadId } from "../types";
import type { ServiceContext } from "./context";
import { ensureRoleFolders } from "./roleFolders";

const log = logger("service.rules");

export type LibraryApi = Pick<FlintApi,
  "listSignatures" | "saveSignature" | "deleteSignature" | "listTemplates" | "saveTemplate" | "deleteTemplate" | "listRules" | "saveRule" | "deleteRule" | "applyRules">;

const id = z.number().int().positive();
const PAGE = 200;

function parseId(value: unknown): number {
  const r = id.safeParse(value);
  if (!r.success) throw new FlintError("invalid", "That id is not valid.");
  return r.data;
}

function checkPatterns(rule: Pick<Rule, "conditions">): void {
  for (const c of rule.conditions) {
    if (c.op !== "matches") continue;
    try {
      new RegExp(c.value, "i");
    } catch {
      throw new FlintError("invalid", `"${c.value}" is not a valid pattern.`);
    }
  }
}

const key = (a: RuleAction): string => JSON.stringify(a);

export function libraryApi(ctx: ServiceContext): LibraryApi {
  const { store } = ctx;

  function requireAccountOrNull(accountId: string | null): void {
    if (accountId !== null && !store.getAccount(accountId)) throw new FlintError("not_found", "That account no longer exists.");
  }

  function requireAccounts(accountIds: string[]): void {
    if (accountIds.some((id) => !store.getAccount(id))) throw new FlintError("invalid", "One of the accounts for that signature doesn't exist.");
  }

  /** Every non-sent message in the inbox's threads, evaluated against the rules. Actions are listed per thread. */
  async function planActions(rules: Rule[], threadIds: ThreadId[]): Promise<Map<ThreadId, RuleAction[]>> {
    if (rules.some((r) => r.conditions.some((c) => c.field === "body"))) {
      await ctx.ensureBodies(threadIds.flatMap((t) => store.getThreadRows(t)?.messages.map((m) => m.id) ?? []));
    }
    const plan = new Map<ThreadId, RuleAction[]>();
    for (const threadId of threadIds) {
      const rows = store.getThreadRows(threadId);
      if (!rows) continue;
      const actions = new Map<string, RuleAction>();
      for (const m of rows.messages.filter((x) => !x.isFromMe && !x.draft)) {
        const msg: RuleMessage = {
          accountId: m.accountId, from: m.from, to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject,
          body: m.text ?? (m.rawHtml ? htmlToPlain(m.rawHtml) : ""), headers: m.headers, hasAttachments: m.hasAttachments,
        };
        for (const a of evaluateRules(rules.filter((r) => r.accountId === null || r.accountId === m.accountId), msg)) actions.set(key(a), a);
      }
      if (actions.size > 0) plan.set(threadId, [...actions.values()]);
    }
    return plan;
  }

  function setCategory(threadIds: ThreadId[], category: string): ActionResult {
    const snapshot = store.snapshotThreads(threadIds);
    const stmt = store.db.prepare("UPDATE threads SET category = ? WHERE id = ?");
    for (const t of threadIds) stmt.run(category, t);
    // Also on the messages, so a rollup or a later re-categorize keeps what the rule decided.
    store.pinCategory(threadIds, category as Category, "rule");
    return { snapshot, locations: [] };
  }

  /** Runs one action for several threads through the optimistic pipeline, so it reaches the server and fails like any other. */
  async function perform(action: RuleAction, threadIds: ThreadId[]): Promise<void> {
    const run = ctx.optimistic.run;
    switch (action.type) {
      case "archive": await run({ label: "archive", local: () => store.moveThreads(threadIds, { kind: "archive" }), server: (a, l) => a.archive(l), op: { kind: "archive" } }); return;
      case "trash":
        ensureRoleFolders(ctx, threadIds, "trash");
        await run({ label: "move to Trash", local: () => store.moveThreads(threadIds, { kind: "trash" }), server: (a, l) => a.trash(l), op: { kind: "trash" } });
        return;
      case "mark_read": await run({ label: "mark as read", local: () => store.markRead(threadIds, true), server: (a, l) => a.setSeen(l, true), op: { kind: "seen", arg: true } }); return;
      case "pin": await run({ label: "pin", local: () => store.setPinned(threadIds, true), server: (a, l) => a.setFlagged(l, true), op: { kind: "flagged", arg: true } }); return;
      case "mute": await run({ label: "mute", local: () => store.setMuted(threadIds, true) }); return;
      case "category": await run({ label: "change the category", local: () => setCategory(threadIds, action.category) }); return;
      case "move": {
        const accounts = ctx.optimistic.accountsOf(threadIds);
        for (const [accountId, ids] of accounts) {
          const folder = store.getFolderByPath(accountId, action.folderPath);
          if (!folder) { log.warn("a rule names a folder that does not exist", { accountId }); continue; }
          await run({ label: "move", local: () => store.moveThreads(ids, { kind: "folder", folderId: folder.id }), server: (a, l) => a.moveToFolder(l, folder.id), op: { kind: "move_folder", arg: folder.id } });
        }
        return;
      }
      case "notify": return;
    }
  }

  return {
    async listSignatures() { return store.listSignatures(); },
    async saveSignature(sig) {
      requireAccounts(sig.accountIds ?? []);
      return store.saveSignature(sig, ctx.now());
    },
    async deleteSignature(sigId) { store.deleteSignature(parseId(sigId)); },

    async listTemplates() { return store.listTemplates(); },
    async saveTemplate(t) { return store.saveTemplate(t, ctx.now()); },
    async deleteTemplate(tid) { store.deleteTemplate(parseId(tid)); },

    async listRules() { return store.listRules(); },
    async saveRule(rule) {
      checkPatterns(rule);
      requireAccountOrNull(rule.accountId);
      return store.saveRule(rule);
    },
    async deleteRule(ruleId) { store.deleteRule(parseId(ruleId)); },

    async applyRules(ruleId) {
      const picked = ruleId == null ? store.listRules().filter((r) => r.enabled) : [store.getRule(parseId(ruleId))];
      if (picked.some((r) => r === null)) throw new FlintError("not_found", "That rule no longer exists.");
      const rules = picked.filter((r): r is Rule => r !== null).map((r) => ({ ...r, enabled: true }));
      if (rules.length === 0) return { changed: 0 };

      const threadIds: ThreadId[] = [];
      for (let cursor: string | undefined; ;) {
        const page = store.listThreads({ view: "inbox", limit: PAGE, ...(cursor ? { cursor } : {}) }, ctx.now());
        threadIds.push(...page.items.map((t) => t.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      const plan = await planActions(rules, threadIds);
      const byAction = new Map<string, { action: RuleAction; threads: ThreadId[] }>();
      for (const [threadId, actions] of plan) {
        for (const a of actions) byAction.set(key(a), { action: a, threads: [...(byAction.get(key(a))?.threads ?? []), threadId] });
      }
      for (const { action, threads } of byAction.values()) await perform(action, threads);
      return { changed: [...plan.entries()].filter(([, actions]) => actions.some((a) => a.type !== "notify")).length };
    },
  };
}
