import type { Account, Category, Folder } from "@flint/core";
import type { NavState } from "./nav";

type MetaInput = Pick<NavState, "view" | "accountId" | "folderId" | "category" | "search" | "searchOpen">;

export const CATEGORY_TITLES: Record<Category, string> = { people: "People", notifications: "Notifications", newsletters: "Newsletters" };

const TITLES: Record<string, string> = {
  home: "Home", inbox: "Inbox", pinned: "Pins", drafts: "Drafts", sent: "Sent", trash: "Trash", spam: "Spam", archive: "Archive",
  snoozed: "Snoozed", scheduled: "Scheduled", blocked: "Blocked", receipts: "Read Statuses", agent_activity: "Agent Activity",
};

export function viewTitle(nav: MetaInput, folders: Folder[] = []): string {
  if (nav.searchOpen && nav.search.trim()) return "Search";
  if (nav.view === "inbox" && nav.category) return CATEGORY_TITLES[nav.category];
  if (nav.view === "folder") return folders.find((f) => f.id === nav.folderId)?.name ?? "Folder";
  return TITLES[nav.view] ?? "Mail";
}

export function viewSubtitle(nav: MetaInput, focused: boolean, accounts: Account[]): string {
  const scope = nav.accountId ? accounts.find((a) => a.id === nav.accountId)?.email ?? "" : accounts.length > 1 ? "All accounts" : "";
  if (nav.searchOpen && nav.search.trim()) return scope || "All mail";
  if (nav.view === "inbox" && !nav.category) return scope ? `${focused ? "Focused" : "All mail"} · ${scope}` : focused ? "Focused" : "All mail";
  return scope;
}

/** Plain empty-state copy per view (DESIGN §8: no emoji, no filler). */
export function emptyCopy(nav: MetaInput): { title: string; description?: string } {
  if (nav.searchOpen && nav.search.trim()) return { title: `No results for "${nav.search.trim()}"`, description: "Try fewer words or remove an operator." };
  switch (nav.view) {
    case "inbox":
      return nav.category ? { title: `No ${CATEGORY_TITLES[nav.category].toLowerCase()}.` } : { title: "Inbox zero.", description: "Nothing waiting for you." };
    case "pinned": return { title: "Nothing pinned.", description: "Press S on a conversation to keep it here." };
    case "drafts": return { title: "No drafts." };
    case "sent": return { title: "Nothing sent yet." };
    case "trash": return { title: "Trash is empty." };
    case "spam": return { title: "No spam." };
    case "archive": return { title: "Nothing archived." };
    case "snoozed": return { title: "Nothing snoozed.", description: "Press H on a conversation to bring it back later." };
    case "blocked": return { title: "No blocked mail." };
    case "folder": return { title: "This folder is empty." };
    default: return { title: "Nothing here." };
  }
}

/** Views where the thread list and reader are shown. Others render one wide column. */
export function isMailView(view: NavState["view"]): boolean {
  return !["home", "receipts", "agent_activity", "scheduled"].includes(view);
}
