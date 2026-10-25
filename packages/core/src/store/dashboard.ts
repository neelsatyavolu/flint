import { sidebarFolders } from "./folderList";
import { roleMember } from "../search";
import type { HomeData, SidebarAccount, SidebarData } from "../types";
import type { AccountsRepo } from "./accounts";
import type { FoldersRepo } from "./folders";
import type { ReceiptsRepo } from "./receipts";
import type { RulesRepo } from "./rulesRepo";
import { NOT_QUEUED_DRAFT } from "./draftList";
import { inUnified, type Sql } from "./sql";
import type { ThreadListRepo } from "./threadList";
import { viewPredicate } from "./threadViews";

/** The service adds sync status to each account. */
export type SidebarAccountData = Omit<SidebarAccount, "sync">;
export type SidebarCounts = SidebarData["counts"];

export class DashboardRepo {
  constructor(
    protected q: Sql,
    private accounts: AccountsRepo,
    private folders: FoldersRepo,
    private lists: ThreadListRepo,
    private receipts: ReceiptsRepo,
    private rulesRepo: RulesRepo,
  ) {}

  /**
   * Accounts with folder counts, plus badge counts. inbox and inboxUnread count threads with an unread message
   * in the inbox (snoozed and blocked excluded); spam counts threads with unread spam; pinned and snoozed count threads.
   */
  getSidebarData(now: number = Date.now()): { accounts: SidebarAccountData[]; counts: SidebarCounts } {
    const accounts = this.accounts.listAccounts();
    const inboxWhere = viewPredicate({ view: "inbox" }, now, this.rulesRepo.blockedPatterns())!;
    const unread = new Map(
      this.q.all<{ account_id: string; n: number }>(
        `SELECT m.account_id, COUNT(DISTINCT m.thread_id) AS n FROM messages m JOIN threads t ON t.id = m.thread_id
         WHERE (${inboxWhere.sql}) AND m.seen = 0 AND m.draft = 0 GROUP BY m.account_id`, ...inboxWhere.params,
      ).map((r) => [r.account_id, r.n]),
    );
    // All-accounts counts leave out disabled accounts and accounts hidden from the unified inbox.
    const enabled = new Set(accounts.filter((a) => a.enabled && a.showInUnified).map((a) => a.id));
    const sidebarAccounts = accounts.map((account) => ({ account, inboxUnread: unread.get(account.id) ?? 0, folders: sidebarFolders(this.folders.listFolders(account.id)) }));
    const serverDrafts = viewPredicate({ view: "drafts" }, now, new Set())!;
    const one = (sql: string, ...p: (string | number)[]) => this.q.get<{ n: number }>(sql, ...p)?.n ?? 0;
    const onEnabled = (n: Iterable<[string, number]>) => [...n].reduce((s, [id, c]) => s + (enabled.has(id) ? c : 0), 0);
    const pinned = onEnabled(this.q.all<{ account_id: string; n: number }>(
      `SELECT t.account_id, COUNT(*) AS n FROM threads t WHERE t.pinned = 1 AND EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND NOT ${roleMember("trash")} AND NOT ${roleMember("spam")}) GROUP BY t.account_id`,
    ).map((r) => [r.account_id, r.n]));
    const snoozed = onEnabled(this.q.all<{ account_id: string; n: number }>("SELECT account_id, COUNT(*) AS n FROM threads WHERE snoozed_until > ? GROUP BY account_id", now).map((r) => [r.account_id, r.n]));
    const spam = onEnabled(this.q.all<{ account_id: string; n: number }>(
      `SELECT m.account_id, COUNT(DISTINCT m.thread_id) AS n FROM messages m WHERE ${roleMember("spam")} AND m.seen = 0 GROUP BY m.account_id`,
    ).map((r) => [r.account_id, r.n]));
    return {
      accounts: sidebarAccounts,
      counts: {
        inbox: onEnabled(unread), pinned, drafts: one(`SELECT COUNT(*) AS n FROM drafts WHERE ${inUnified("account_id")} AND ${NOT_QUEUED_DRAFT}`)
          + one(`SELECT COUNT(DISTINCT m.thread_id) AS n FROM messages m JOIN threads t ON t.id = m.thread_id WHERE ${serverDrafts.sql} AND ${inUnified("m.account_id")}`, ...serverDrafts.params), snoozed,
        scheduled: one("SELECT COUNT(*) AS n FROM scheduled_sends WHERE status IN ('pending','sending')"),
        awaitingApproval: one("SELECT COUNT(*) AS n FROM scheduled_sends WHERE status = 'awaiting_approval'"), spam,
      },
    };
  }

  /** Home screen data: up to five of each list. */
  getHomeData(now: number = Date.now()): HomeData {
    const first = this.accounts.listAccounts().find((a) => a.enabled);
    const name = first ? (first.name.trim().split(/\s+/)[0] || first.email.split("@")[0] || "") : "";
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const hidden = new Set(this.accounts.listAccounts().filter((a) => !a.showInUnified).map((a) => a.id));
    const awaitingIds = this.q.all<{ thread_id: number }>(
      "SELECT DISTINCT thread_id FROM reminders WHERE status = 'pending' AND thread_id IS NOT NULL ORDER BY remind_at LIMIT 5",
    ).map((r) => r.thread_id);
    return {
      greetingName: name,
      unreadPeople: this.lists.listThreads({ view: "inbox", focused: true, unreadOnly: true, limit: 5 }, now).items,
      pinned: this.lists.listThreads({ view: "pinned", limit: 5 }, now).items,
      awaitingReply: this.lists.itemsForThreads(awaitingIds).filter((i) => !hidden.has(i.accountId)),
      recentReceipts: this.receipts.listTracked({ limit: 5 }),
      snoozedToday: this.q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM threads WHERE snoozed_until > ? AND snoozed_until <= ? AND ${inUnified("account_id")}`, now, endOfDay.getTime())?.n ?? 0,
      scheduledCount: this.q.get<{ n: number }>("SELECT COUNT(*) AS n FROM scheduled_sends WHERE status IN ('pending','awaiting_approval')")?.n ?? 0,
    };
  }
}
