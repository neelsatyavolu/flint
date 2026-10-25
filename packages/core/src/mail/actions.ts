import type { Store } from "../store";
import type { MessageLocation } from "../store/types";
import { FlintError, type AccountId, type FolderId, type MailboxRole } from "../types";
import { logger } from "../log";
import type { ImapFlow } from "imapflow";
import { withMailbox, type ImapRunner } from "./runner";

const log = logger("mail.actions");

export type ActionError = { op: string; messageRowId: number; folderPath: string; uid: number; message: string };
export type ActionReport = {
  ok: boolean;
  errors: ActionError[];
  /** Messages whose server operation failed. The service restores their threads from the action snapshot. */
  failedMessageIds: number[];
};

type Group = { folderId: FolderId; path: string; locs: MessageLocation[] };
type Target = { id: FolderId; path: string };

const GMAIL_INBOX_LABEL = "\\Inbox";

function groupByFolder(locs: MessageLocation[]): Group[] {
  const map = new Map<FolderId, Group>();
  for (const loc of locs) {
    const g = map.get(loc.folderId) ?? { folderId: loc.folderId, path: loc.folderPath, locs: [] };
    g.locs.push(loc);
    map.set(loc.folderId, g);
  }
  return [...map.values()];
}

const uidSet = (g: Group): string => g.locs.map((l) => l.uid).join(",");
const isGmail = (l: MessageLocation): boolean => l.provider === "gmail";
const staysPut = (l: MessageLocation): boolean => l.folderRole === "sent" || l.folderRole === "drafts";

/**
 * Executes thread actions on the server for the messages the store reports in ActionResult.locations.
 * Work is batched per source folder. Failures are returned per message; nothing throws for a server error.
 */
export class ServerActions {
  constructor(private readonly store: Store, private readonly accountId: AccountId, private readonly runner: ImapRunner) {}

  setSeen(locs: MessageLocation[], seen: boolean): Promise<ActionReport> {
    return this.#flag(locs, "\\Seen", seen, "setSeen");
  }

  setFlagged(locs: MessageLocation[], flagged: boolean): Promise<ActionReport> {
    return this.#flag(locs, "\\Flagged", flagged, "setFlagged");
  }

  setAnswered(locs: MessageLocation[]): Promise<ActionReport> {
    return this.#flag(locs, "\\Answered", true, "setAnswered");
  }

  /** Gmail removes the Inbox label; other servers MOVE to the Archive folder, created when missing. */
  async archive(locs: MessageLocation[]): Promise<ActionReport> {
    const errors: ActionError[] = [];
    const gmail = locs.filter(isGmail);
    const generic = locs.filter((l) => !isGmail(l) && !staysPut(l) && l.folderRole !== "archive");
    await this.#each(groupByFolder(gmail.filter((l) => l.folderRole !== "trash" && l.folderRole !== "spam")), "archive", errors, (c, g) =>
      c.messageFlagsRemove(uidSet(g), [GMAIL_INBOX_LABEL], { uid: true, useLabels: true }));
    if (generic.length) {
      const target = this.#roleTarget(generic[0]!.accountId, "archive", errors, generic, "archive");
      if (target) await this.#move(generic, target, "archive", errors);
    }
    return report(errors);
  }

  async trash(locs: MessageLocation[]): Promise<ActionReport> {
    return this.#toRole(locs.filter((l) => l.folderRole !== "trash"), "trash");
  }

  async spam(locs: MessageLocation[]): Promise<ActionReport> {
    return this.#toRole(locs.filter((l) => l.folderRole !== "spam"), "spam");
  }

  /** Not spam: back to the inbox. */
  unspam(locs: MessageLocation[]): Promise<ActionReport> {
    return this.moveToInbox(locs);
  }

  async moveToInbox(locs: MessageLocation[]): Promise<ActionReport> {
    const errors: ActionError[] = [];
    const gmail = locs.filter(isGmail);
    const inAllMail = gmail.filter((l) => l.folderRole !== "trash" && l.folderRole !== "spam");
    const inTrashOrSpam = gmail.filter((l) => l.folderRole === "trash" || l.folderRole === "spam");
    await this.#each(groupByFolder(inAllMail), "moveToInbox", errors, (c, g) => c.messageFlagsAdd(uidSet(g), [GMAIL_INBOX_LABEL], { uid: true, useLabels: true }));
    // Gmail copies mail out of Trash and Spam into INBOX; the next sync reconciles the location.
    await this.#each(groupByFolder(inTrashOrSpam), "moveToInbox", errors, async (c, g) => { await c.messageMove(uidSet(g), "INBOX", { uid: true }); return true; });
    const generic = locs.filter((l) => !isGmail(l) && !staysPut(l) && l.folderRole !== "inbox");
    if (generic.length) {
      const target = this.#roleTarget(generic[0]!.accountId, "inbox", errors, generic, "moveToInbox");
      if (target) await this.#move(generic, target, "moveToInbox", errors);
    }
    return report(errors);
  }

  async moveToFolder(locs: MessageLocation[], folderId: FolderId): Promise<ActionReport> {
    const errors: ActionError[] = [];
    const folder = this.store.getFolder(folderId);
    if (!folder) return failAll(locs, "moveToFolder", "That folder no longer exists.");
    if (folder.role === "trash" || folder.role === "spam") return this.#toRole(locs, folder.role);
    if (folder.role === "archive" || folder.role === "all") return this.archive(locs);
    if (folder.role === "inbox") return this.moveToInbox(locs);
    const gmail = locs.filter(isGmail);
    // A Gmail label: apply it and take the message out of the inbox.
    await this.#each(groupByFolder(gmail), "moveToFolder", errors, async (c, g) => {
      await c.messageFlagsAdd(uidSet(g), [folder.path], { uid: true, useLabels: true });
      return c.messageFlagsRemove(uidSet(g), [GMAIL_INBOX_LABEL], { uid: true, useLabels: true });
    });
    const generic = locs.filter((l) => !isGmail(l) && !staysPut(l));
    await this.#move(generic, { id: folder.id, path: folder.path }, "moveToFolder", errors);
    return report(errors);
  }

  // ---- internals

  async #toRole(locs: MessageLocation[], role: "trash" | "spam"): Promise<ActionReport> {
    const errors: ActionError[] = [];
    if (locs.length === 0) return report(errors);
    const target = this.#roleTarget(locs[0]!.accountId, role, errors, locs, role);
    if (target) await this.#move(locs, target, role, errors);
    return report(errors);
  }

  #roleTarget(accountId: AccountId, role: MailboxRole, errors: ActionError[], locs: MessageLocation[], op: string): Target | null {
    try {
      const folder = this.store.ensureFolderByRole(accountId, role);
      return { id: folder.id, path: folder.path };
    } catch (error) {
      pushAll(errors, locs, op, error instanceof FlintError ? error.message : `No ${role} folder.`);
      return null;
    }
  }

  async #move(locs: MessageLocation[], target: Target, op: string, errors: ActionError[]): Promise<void> {
    const groups = groupByFolder(locs.filter((l) => l.folderId !== target.id));
    await this.#each(groups, op, errors, async (c, g) => {
      const res = await moveCreating(c, uidSet(g), target.path);
      if (res && res.uidMap) {
        for (const loc of g.locs) {
          const newUid = res.uidMap.get(loc.uid);
          if (newUid !== undefined) this.store.relocateMessage(loc.messageRowId, target.id, newUid);
        }
      }
      return true;
    });
  }

  async #flag(locs: MessageLocation[], flag: string, on: boolean, op: string): Promise<ActionReport> {
    const errors: ActionError[] = [];
    await this.#each(groupByFolder(locs), op, errors, (c, g) =>
      on ? c.messageFlagsAdd(uidSet(g), [flag], { uid: true }) : c.messageFlagsRemove(uidSet(g), [flag], { uid: true }));
    return report(errors);
  }

  async #each(groups: Group[], op: string, errors: ActionError[], fn: (c: ImapFlow, g: Group) => Promise<unknown>): Promise<void> {
    for (const g of groups) {
      if (g.locs.some((l) => l.accountId !== this.accountId)) {
        pushAll(errors, g.locs, op, "That message belongs to another account.");
        continue;
      }
      try {
        const result = await this.runner.run((c) => withMailbox(c, g.path, () => fn(c, g)));
        if (result === false) throw new Error("The server refused the change.");
      } catch (error) {
        const message = (error as Error).message || "The server refused the change.";
        log.warn("server action failed", { op, folder: g.path, reason: message });
        pushAll(errors, g.locs, op, message);
      }
    }
  }
}

/** MOVE to a folder. When the server refuses, create the folder (it may not exist yet) and try once more. */
async function moveCreating(c: ImapFlow, uids: string, path: string): Promise<Exclude<Awaited<ReturnType<ImapFlow["messageMove"]>>, false>> {
  const attempt = async () => c.messageMove(uids, path, { uid: true }).catch(() => false as const);
  const first = await attempt();
  if (first) return first;
  await c.mailboxCreate(path).catch(() => undefined);
  const second = await attempt();
  if (second) return second;
  throw new Error("The server refused to move the message.");
}

function pushAll(errors: ActionError[], locs: MessageLocation[], op: string, message: string): void {
  for (const l of locs) errors.push({ op, messageRowId: l.messageRowId, folderPath: l.folderPath, uid: l.uid, message });
}

function report(errors: ActionError[]): ActionReport {
  return { ok: errors.length === 0, errors, failedMessageIds: [...new Set(errors.map((e) => e.messageRowId))] };
}

function failAll(locs: MessageLocation[], op: string, message: string): ActionReport {
  const errors: ActionError[] = [];
  pushAll(errors, locs, op, message);
  return report(errors);
}
