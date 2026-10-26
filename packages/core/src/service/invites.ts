import type { FlintApi } from "../api";
import type { ServiceContext } from "./context";
import { FlintError } from "../types";
import { conflictsFor, connectGoogleCalendar } from "./invites-google";
import { createRsvp } from "./invites-imip";
import { ensureInvite, getInvite, listInvites } from "./invites-read";

/** Calendar invitations. Contracts and ownership: ../calendar/contracts.ts. */
export type InvitesApi = Pick<FlintApi, "getInvite" | "rsvp" | "inviteConflicts" | "connectGoogleCalendar" | "listInvites">;

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
      return conflictsFor(ctx, account, stored.invite);
    },
    connectGoogleCalendar: (accountId) => connectGoogleCalendar(ctx, accountId),
    listInvites: (opts) => listInvites(ctx, opts),
  };
}
