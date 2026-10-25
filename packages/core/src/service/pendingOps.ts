import type { ActionReport, ServerActions } from "../mail/actions";
import type { PendingOp } from "../store/pendingOps";
import type { MessageLocation } from "../store/types";

/** Runs a recorded operation against the server. */
export function applyPendingOp(actions: ServerActions, op: Pick<PendingOp, "kind" | "arg">, locs: MessageLocation[]): Promise<ActionReport> {
  switch (op.kind) {
    case "seen": return actions.setSeen(locs, op.arg === true);
    case "flagged": return actions.setFlagged(locs, op.arg === true);
    case "archive": return actions.archive(locs);
    case "trash": return actions.trash(locs);
    case "spam": return actions.spam(locs);
    case "unspam": return actions.unspam(locs);
    case "move_inbox": return actions.moveToInbox(locs);
    case "move_folder": return actions.moveToFolder(locs, Number(op.arg));
  }
}
