import type { ActionReport } from "../mail/actions";
import type { Store } from "../store";
import type { MessageLocation, ThreadSnapshot } from "../store/types";
import type { FolderId, MailboxRole, MessageRowId } from "../types";
import type { InverseOp } from "./undo";

const merge = (reports: ActionReport[]): ActionReport => {
  const errors = reports.flatMap((r) => r.errors);
  return { ok: errors.length === 0, errors, failedMessageIds: [...new Set(reports.flatMap((r) => r.failedMessageIds))] };
};

/** Server inverse of markRead: put each message back to its pre-change \Seen state (the store was restored first). */
export const inverseSeen: InverseOp = async (actions, locs) =>
  merge([await actions.setSeen(locs.filter((l) => l.seen), true), await actions.setSeen(locs.filter((l) => !l.seen), false)]);

/** Server inverse of setPinned: put each message back to its pre-change \Flagged state. */
export const inverseFlagged: InverseOp = async (actions, locs) =>
  merge([await actions.setFlagged(locs.filter((l) => l.flagged), true), await actions.setFlagged(locs.filter((l) => !l.flagged), false)]);

type Home = { kind: "inbox" | "trash" | "spam" | "archive" } | { kind: "folder"; folderId: FolderId } | null;

/** Where a message lived before the action, from the snapshot's membership. Sent and draft mail never moves. */
function homeOf(store: Store, memberFolderIds: FolderId[]): Home {
  const folders = memberFolderIds.map((id) => store.getFolder(id)).filter((f): f is NonNullable<typeof f> => f !== null);
  const roles = new Set<MailboxRole | null>(folders.map((f) => f.role));
  if (roles.has("sent") || roles.has("drafts")) return null;
  if (roles.has("inbox")) return { kind: "inbox" };
  if (roles.has("trash")) return { kind: "trash" };
  if (roles.has("spam")) return { kind: "spam" };
  const user = folders.find((f) => f.role === null);
  if (user) return { kind: "folder", folderId: user.id };
  if (roles.has("archive") || roles.has("all")) return { kind: "archive" };
  return null;
}

/** Server inverse of any move: send each message back to the place the snapshot says it came from. */
export const inverseMove = (store: Store): InverseOp => async (actions, locs, snapshot: ThreadSnapshot) => {
  const before = new Map<MessageRowId, FolderId[]>();
  for (const t of snapshot.threads) for (const m of t.messages) before.set(m.id, m.memberFolderIds);
  const inbox: MessageLocation[] = [];
  const trash: MessageLocation[] = [];
  const spam: MessageLocation[] = [];
  const archive: MessageLocation[] = [];
  const folders = new Map<FolderId, MessageLocation[]>();
  for (const loc of locs) {
    const home = homeOf(store, before.get(loc.messageRowId) ?? []);
    if (!home) continue;
    if (home.kind === "folder") folders.set(home.folderId, [...(folders.get(home.folderId) ?? []), loc]);
    else ({ inbox, trash, spam, archive })[home.kind].push(loc);
  }
  const reports: ActionReport[] = [];
  if (inbox.length) reports.push(await actions.moveToInbox(inbox));
  if (trash.length) reports.push(await actions.trash(trash));
  if (spam.length) reports.push(await actions.spam(spam));
  if (archive.length) reports.push(await actions.archive(archive));
  for (const [folderId, group] of folders) reports.push(await actions.moveToFolder(group, folderId));
  return merge(reports);
};
