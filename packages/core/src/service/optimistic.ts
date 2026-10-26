import { logger } from "../log";
import type { ActionReport, ServerActions } from "../mail/actions";
import type { Store } from "../store";
import type { PendingOp, PendingOpSpec } from "../store/pendingOps";
import type { ActionResult, MessageLocation, ThreadSnapshot } from "../store/types";
import { FlintError, type AccountId, type FlintEvent, type MessageRowId, type ThreadId } from "../types";
import { applyPendingOp } from "./pendingOps";
import type { InverseOp, UndoRegistry } from "./undo";

const log = logger("service.actions");

export type ServerOp = (actions: ServerActions, locs: MessageLocation[]) => Promise<ActionReport>;

export type OptimisticSpec = {
  /** Past the "Couldn't ..." in the failure toast, e.g. "archive". */
  label: string;
  /** Applies the change to the store and returns what the server has to do. */
  local: () => ActionResult;
  /** Server follow-up. Omit for local-only actions such as snooze and mute. */
  server?: ServerOp;
  /** What `server` does, in a form that survives a restart. When set, the operation is recorded before it runs (see replayPending). */
  op?: PendingOpSpec;
  /** Server operation that undoes the change after the store was restored. */
  inverse?: InverseOp;
};

export type OptimisticDeps = {
  store: Store;
  emit: (event: FlintEvent) => void;
  undo: UndoRegistry;
  actionsFor: (accountId: AccountId) => ServerActions;
  /** Name of the agent behind the current call, or undefined for the UI. */
  caller: () => string | undefined;
  now?: () => number;
};

/** Failed replays tolerated before a recorded operation is dropped (sync then settles the mailbox) and the age after which it is dropped. */
const REPLAY_ATTEMPTS = 3;
const REPLAY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type Optimistic = {
  /** Re-runs server operations that were recorded but never finished, e.g. because the app was closed mid-action. */
  replayPending(): Promise<number>;
  run(spec: OptimisticSpec): Promise<{ undoToken: string }>;
  undo(token: string): Promise<void>;
  changed(accountThreads: Map<AccountId, ThreadId[]>): void;
  accountsOf(threadIds: ThreadId[]): Map<AccountId, ThreadId[]>;
};

const toast = (message: string, undoToken?: string): FlintEvent =>
  ({ type: "toast", level: "error", message, ...(undoToken ? { undoToken } : {}) });

/** Thread ids grouped by the account they belong to. */
function groupThreads(store: Store, threadIds: ThreadId[]): Map<AccountId, ThreadId[]> {
  const out = new Map<AccountId, Set<ThreadId>>();
  for (const loc of store.getThreadLocations(threadIds)) out.set(loc.accountId, (out.get(loc.accountId) ?? new Set()).add(loc.threadId));
  return new Map([...out].map(([account, ids]) => [account, [...ids]]));
}

function groupLocations(locs: MessageLocation[]): Map<AccountId, MessageLocation[]> {
  const out = new Map<AccountId, MessageLocation[]>();
  for (const l of locs) out.set(l.accountId, [...(out.get(l.accountId) ?? []), l]);
  return out;
}

/** Messages whose server operation failed, across accounts. Whole account fails when its runner cannot be built or throws. */
async function runOnServer(d: OptimisticDeps, locs: MessageLocation[], op: (a: ServerActions, l: MessageLocation[]) => Promise<ActionReport>): Promise<Set<MessageRowId>> {
  const failed = new Set<MessageRowId>();
  for (const [accountId, group] of groupLocations(locs)) {
    try {
      const report = await op(d.actionsFor(accountId), group);
      if (!report.ok) {
        log.warn("server action failed", { accountId, failed: report.failedMessageIds.length, reason: report.errors[0]?.message });
        for (const id of report.failedMessageIds) failed.add(id);
      }
    } catch (error) {
      log.warn("server action threw", { accountId, reason: (error as Error).message });
      for (const l of group) failed.add(l.messageRowId);
    }
  }
  return failed;
}

/** Only the threads that hold a failed message, so threads that did reach the server keep their new state. */
function failedPart(snapshot: ThreadSnapshot, failed: ReadonlySet<MessageRowId>): ThreadSnapshot {
  return { ...snapshot, threads: snapshot.threads.filter((t) => t.messages.some((m) => failed.has(m.id))) };
}

/**
 * The optimistic action pipeline: local store change, mail_changed, server operation. When the server refuses,
 * the affected threads are restored and a toast explains. Agent callers get a thrown FlintError instead of a toast.
 */
export function createOptimistic(d: OptimisticDeps): Optimistic {
  const changed = (byAccount: Map<AccountId, ThreadId[]>): void => {
    for (const [accountId, threadIds] of byAccount) d.emit({ type: "mail_changed", accountId, threadIds });
  };
  const accountsOf = (threadIds: ThreadId[]) => groupThreads(d.store, threadIds);

  const fail = (message: string): void => {
    if (d.caller()) throw new FlintError("network", message);
    d.emit(toast(message));
  };

  /** The server operation wrapped so it is on disk while it runs. A crash leaves the row behind for replayPending. */
  function durable(spec: OptimisticSpec): ServerOp {
    const server = spec.server!;
    const { op } = spec;
    if (!op) return server;
    return async (actions, group) => {
      const accountId = group[0]?.accountId;
      const id = accountId ? d.store.addPendingOp(accountId, op, group.map((l) => l.messageRowId), (d.now ?? Date.now)()) : null;
      try {
        return await server(actions, group);
      } finally {
        if (id !== null) d.store.removePendingOp(id);
      }
    };
  }

  async function replayOne(p: PendingOp): Promise<void> {
    const locs = d.store.getMessageLocations(p.messageIds);
    if (locs.length === 0) return void d.store.removePendingOp(p.id);
    const failed = await runOnServer(d, locs, (actions, group) => applyPendingOp(actions, p, group));
    if (failed.size === 0) return void d.store.removePendingOp(p.id);
    if (d.store.bumpPendingOp(p.id, "server refused the replayed operation") >= REPLAY_ATTEMPTS) d.store.removePendingOp(p.id);
  }

  async function replayPending(): Promise<number> {
    const now = (d.now ?? Date.now)();
    let ran = 0;
    for (const p of d.store.listPendingOps()) {
      if (now - p.createdAt > REPLAY_MAX_AGE_MS) { d.store.removePendingOp(p.id); continue; }
      try {
        await replayOne(p);
        ran += 1;
      } catch (error) {
        log.warn("could not replay a pending operation", { id: p.id, kind: p.kind, reason: (error as Error).message });
      }
    }
    return ran;
  }

  async function run(spec: OptimisticSpec): Promise<{ undoToken: string }> {
    const result = spec.local();
    const threadIds = result.snapshot.threads.map((t) => t.id);
    const token = d.undo.register({
      label: spec.label,
      snapshot: result.snapshot,
      affected: result.locations.map((l) => l.messageRowId),
      ...(spec.inverse ? { inverse: spec.inverse } : {}),
    });
    changed(accountsOf(threadIds));
    if (!spec.server || result.locations.length === 0) return { undoToken: token };

    const failed = await runOnServer(d, result.locations, durable(spec));
    if (failed.size === 0) return { undoToken: token };

    const restored = d.store.restoreSnapshot(failedPart(result.snapshot, failed));
    changed(accountsOf(restored));
    d.undo.discard(token);
    fail(`Couldn't ${spec.label}. The change was undone.`);
    return { undoToken: token };
  }

  async function undo(token: string): Promise<void> {
    const entry = d.undo.take(token);
    const threadIds = d.store.restoreSnapshot(entry.snapshot);
    changed(accountsOf(threadIds));
    if (!entry.inverse) return;
    const inverse = entry.inverse;
    const locs = d.store.getMessageLocations(entry.affected);
    const failed = await runOnServer(d, locs, (actions, group) => inverse(actions, group, entry.snapshot));
    if (failed.size > 0) fail(`Couldn't undo ${entry.label} on the server. It will correct itself on the next sync.`);
  }

  return { run, undo, changed, accountsOf, replayPending };
}
