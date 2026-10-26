import type { FlintApi } from "../api";
import type { ServiceContext } from "./context";
import { FlintError } from "../types";
import { addCalDavAccount, addGoogleCalendarAccount } from "./calendarAccountsAdd";
import { listCalendarAccounts, removeCalendarAccount, updateCalendarAccount } from "./calendarAccounts";
import { connectGoogleCalendar } from "./invites-google";
import { inviteConflictsFor } from "./invites-calendars";
import { createRsvp } from "./invites-imip";
import { ensureInvite, getInvite, listInvites } from "./invites-read";

/** Calendar invitations. Contracts and ownership: ../calendar/contracts.ts. */
export type InvitesApi = Pick<FlintApi, "getInvite" | "rsvp" | "inviteConflicts" | "connectGoogleCalendar" | "listInvites" | "listCalendarAccounts" | "addGoogleCalendarAccount" | "addCalDavAccount" | "updateCalendarAccount" | "removeCalendarAccount">;

export function invitesApi(ctx: ServiceContext): InvitesApi {
  const answer = createRsvp(ctx, { reload: (id) => getInvite(ctx, id) });
  return {
    getInvite: (messageId) => getInvite(ctx, messageId),
    rsvp: async (messageId, response, note) => {
      await ensureInvite(ctx, messageId); // the card may be answered before the calendar part was downloaded
      const invite = await answer(messageId, response, note);
      const message = ctx.store.getMessage(messageId);
      if (message) ctx.emit({ type: "mail_changed", accountId: message.accountId, threadIds: [message.threadId] });
      return invite;
    },
    inviteConflicts: async (messageId) => {
      const stored = await ensureInvite(ctx, messageId);
      if (!stored) throw new FlintError("not_found", "That message has no invitation.");
      const account = ctx.store.requireAccount(stored.accountId);
      return inviteConflictsFor(ctx, account, stored.invite);
    },
    connectGoogleCalendar: (accountId) => connectGoogleCalendar(ctx, accountId),
    listInvites: (opts) => listInvites(ctx, opts),
    listCalendarAccounts: async () => listCalendarAccounts(ctx),
    addGoogleCalendarAccount: (input) => addGoogleCalendarAccount(ctx, input),
    addCalDavAccount: (input) => addCalDavAccount(ctx, input),
    updateCalendarAccount: async (id, patch) => updateCalendarAccount(ctx, id, patch),
    removeCalendarAccount: (id) => removeCalendarAccount(ctx, id),
  };
}
