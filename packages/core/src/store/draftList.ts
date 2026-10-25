import type { Address, ThreadListItem } from "../types";
import { htmlToPlain } from "./fts";
import { addresses } from "./mappers";
import { parseJson, type Sql } from "./sql";

const SNIPPET_CHARS = 140;
export const NO_SUBJECT = "(No subject)";

type LocalDraftRow = {
  id: number; account_id: string; to_json: string; cc_json: string; bcc_json: string; subject: string; html: string; thread_id: number | null;
  attachments_json: string; updated_at: number;
};

export type DraftListEntry = { key: number; id: number; item: ThreadListItem };

/** Plain text preview of a draft body, whitespace collapsed. */
export function draftSnippet(html: string): string {
  return htmlToPlain(html).replace(/\s+/g, " ").trim().slice(0, SNIPPET_CHARS);
}

/** Id a local draft carries in the Drafts list. Negative, so it never collides with a thread id. */
export const draftRowId = (draftId: number): number => -draftId;

/** Every local draft as a Drafts-list row, newest edit first. `accountId` narrows to one account. */
export function localDraftEntries(q: Sql, accountId: string | undefined): DraftListEntry[] {
  const rows = accountId
    ? q.all<LocalDraftRow>("SELECT * FROM drafts WHERE account_id = ?", accountId)
    : q.all<LocalDraftRow>("SELECT * FROM drafts");
  return rows.map((r) => {
    const people: Address[] = [...addresses(r.to_json), ...addresses(r.cc_json), ...addresses(r.bcc_json)];
    const id = draftRowId(r.id);
    return {
      key: r.updated_at, id,
      item: {
        id, accountId: r.account_id, subject: r.subject.trim() || NO_SUBJECT, snippet: draftSnippet(r.html), participants: people,
        lastDate: r.updated_at, messageCount: 1, unreadCount: 0, hasAttachments: parseJson<unknown[]>(r.attachments_json, []).length > 0,
        pinned: false, muted: false, snoozedUntil: null, category: "people", hasDraft: true, receipt: null,
        draft: { draftId: r.id, messageId: null },
      },
    };
  });
}
