import { logger } from "../../log";
import type { Store } from "../../store";
import type { ActionResult, IngestOutcome } from "../../store/types";
import type { AccountId, FlintEvent, RuleAction, ThreadId } from "../../types";
import type { ActionReport, ServerActions } from "../actions";
import type { Batch } from "./folderSync";

const log = logger("mail.outcomes");

export type OutcomeDeps = {
  store: Store;
  accountId: AccountId;
  actions: ServerActions;
  emit: (e: FlintEvent) => void;
};

/** Applies a local change, runs the server part, and puts the local state back when the server refuses. */
async function perform(d: OutcomeDeps, local: () => ActionResult, server: (r: ActionResult) => Promise<ActionReport>, label: string): Promise<ThreadId[]> {
  let result: ActionResult;
  try {
    result = local();
  } catch (error) {
    log.warn("rule action skipped", { action: label, reason: (error as Error).message });
    return [];
  }
  const rep = await server(result);
  if (!rep.ok) {
    log.warn("rule action failed on the server", { action: label, reason: rep.errors[0]?.message });
    d.store.restoreSnapshot(result.snapshot);
  }
  return result.snapshot.threads.map((t) => t.id);
}

async function runRuleAction(d: OutcomeDeps, threadId: ThreadId, action: RuleAction): Promise<ThreadId[]> {
  const { store, actions } = d;
  switch (action.type) {
    case "archive":
      return perform(d, () => store.moveThreads([threadId], { kind: "archive" }), (r) => actions.archive(r.locations), "archive");
    case "trash":
      return perform(d, () => store.moveThreads([threadId], { kind: "trash" }), (r) => actions.trash(r.locations), "trash");
    case "move": {
      const folder = store.getFolderByPath(d.accountId, action.folderPath);
      if (!folder) return [];
      return perform(d, () => store.moveThreads([threadId], { kind: "folder", folderId: folder.id }), (r) => actions.moveToFolder(r.locations, folder.id), "move");
    }
    case "mark_read":
      return perform(d, () => store.markRead([threadId], true), (r) => actions.setSeen(r.locations, true), "mark_read");
    case "pin":
      return perform(d, () => store.setPinned([threadId], true), (r) => actions.setFlagged(r.locations, true), "pin");
    default:
      return [];
  }
}

/**
 * Server-side follow-up for one ingested batch: blocked senders go to Trash, rule actions run.
 * Returns the threads whose state changed so the caller can emit mail_changed.
 */
export async function applyOutcomeActions(d: OutcomeDeps, outcomes: IngestOutcome[]): Promise<ThreadId[]> {
  const touched = new Set<ThreadId>();
  const done = new Set<string>();
  for (const o of outcomes) {
    if (o.blocked) {
      const locs = d.store.getMessageLocations([o.messageRowId]);
      const rep = await d.actions.trash(locs);
      if (!rep.ok) log.warn("could not trash a blocked message", { reason: rep.errors[0]?.message });
      touched.add(o.threadId);
      continue;
    }
    for (const action of o.ruleActions) {
      const key = `${o.threadId}:${JSON.stringify(action)}`;
      if (done.has(key)) continue;
      done.add(key);
      for (const id of await runRuleAction(d, o.threadId, action)) touched.add(id);
    }
  }
  return [...touched];
}

/** new_mail events: inbox mail from someone else that is unread, in the people category or asked for by a rule, in a thread that is not muted and that no rule moved out of the inbox. */
export function newMailEvents(d: Pick<OutcomeDeps, "store" | "accountId">, batch: Batch, inboxPath: string | null): FlintEvent[] {
  const events: FlintEvent[] = [];
  const byUid = new Map(batch.items.map((i) => [i.uid, i]));
  for (const o of batch.outcomes) {
    const item = byUid.get(o.uid);
    if (!item || !o.isNew || o.fromMe || o.blocked || item.flags.seen || item.flags.draft) continue;
    const inInbox = item.gmLabels ? inboxPath !== null && item.gmLabels.includes(inboxPath) : batch.folder.role === "inbox";
    if (!inInbox) continue;
    const notify = o.ruleActions.find((a): a is Extract<RuleAction, { type: "notify" }> => a.type === "notify");
    if (notify?.enabled === false) continue;
    if (o.category !== "people" && !notify?.enabled) continue;
    if (o.ruleActions.some((a) => a.type === "mute" || a.type === "archive" || a.type === "trash" || a.type === "move")) continue;
    if (d.store.itemsForThreads([o.threadId])[0]?.muted) continue;
    const from = item.from[0] ?? { name: "", address: "" };
    events.push({ type: "new_mail", accountId: d.accountId, threadId: o.threadId, from, subject: item.subject, category: o.category });
  }
  return events;
}
