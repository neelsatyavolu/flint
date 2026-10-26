import type { ImapFlow } from "imapflow";
import { MAX_ICS_BYTES, decodeIcs, ownAddressesOf, parseAndStore } from "../../calendar/capture";
import { logger } from "../../log";
import type { Store } from "../../store";
import { downloadPart } from "./attachments";

const log = logger("sync.invites");
const MAX_PARTS = 3;

/**
 * Looks for a calendar invitation in one message right after its body was fetched: downloads its text/calendar part (or .ics
 * attachment) on the open connection, parses it and stores the result. Messages without such a part are marked scanned.
 * A download error leaves the message unscanned, so opening it later tries again. The mailbox must be selected (hold a lock).
 */
export async function captureInvite(c: ImapFlow, o: { store: Store; accountId: string; messageRowId: number; uid: number; now: number }): Promise<void> {
  const { store } = o;
  try {
    const parts = store.calendarAttachments(o.messageRowId).filter((p) => p.size <= MAX_ICS_BYTES).slice(0, MAX_PARTS);
    const account = store.getAccount(o.accountId);
    if (parts.length === 0 || !account) {
      store.markInviteChecked([o.messageRowId]);
      return;
    }
    for (const part of parts) {
      const ics = decodeIcs(await downloadPart(c, o.uid, part.part));
      if (parseAndStore(ics, { store, accountId: o.accountId, messageId: o.messageRowId, ownAddresses: ownAddressesOf(account), now: o.now })) return;
    }
    store.markInviteChecked([o.messageRowId]);
  } catch (error) {
    log.debug("could not read a calendar part", { messageId: o.messageRowId, reason: (error as Error).message });
  }
}
