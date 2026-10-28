import { buildImipReply } from "../calendar/imip";
import type { InviteStore, ParsedInvite, SendImip, StoredInvite } from "../calendar/contracts";
import { logger } from "../log";
import { sendUntracked } from "../mail/send";
import type { StoredResponse } from "../calendar/contracts";
import { FlintError, type Account, type Address, type Invite, type MessageRowId, type RsvpResponse } from "../types";
import type { ServiceContext } from "./context";
import { resolveRoute, selfAddressesOf } from "./calendarRouting";
import { rsvpViaGoogle } from "./invites-google";
import { rsvpViaCalDav, rsvpViaGoogleCalendar, serverReplies } from "./invites-calendars";
import { openTransport, sentFolders } from "./send";

const log = logger("service.invites-imip");

/** The real SendImip: SMTP from the invited account, filed in Sent. Never tracked, never a pixel, never touches receipts. */
export function realSendImip(ctx: ServiceContext): SendImip {
  return async (account, reply) => {
    const transport = await openTransport(ctx, account);
    try {
      await sendUntracked(transport, {
        message: {
          from: reply.from, to: [reply.to], subject: reply.subject, text: reply.text, html: reply.html,
          icalEvent: { method: "REPLY", content: reply.ics }, date: new Date(ctx.now()),
        },
        folders: sentFolders(ctx, account),
        runner: ctx.syncs.get(account.id),
      });
    } finally {
      transport.close();
    }
  };
}

export type RsvpDeps = {
  /** The merged invite for a message (state, yourResponse, rsvpVia); the stored data plus the local response. */
  reload(messageId: MessageRowId): Promise<Invite | null>;
};

const inviteStore = (ctx: ServiceContext): InviteStore => ctx.store as unknown as InviteStore;

/** Why an invite takes no answer, in words for the person. */
function refusal(invite: Invite): string | null {
  switch (invite.state) {
    case "cancelled": return "This event was cancelled, so there is nothing to answer.";
    case "past": return "This event is over.";
    case "superseded": return "A newer version of this invitation exists. Answer that one.";
    case "reply": case "counter": return "This message is a reply, not an invitation, so there is nothing to answer.";
    default: break;
  }
  if (invite.method !== "REQUEST") return "This is not an invitation that asks for an answer.";
  if (!invite.invitedAs) return "You are not on this invitation's guest list.";
  return null;
}

/** The address the user was invited at: the matching ATTENDEE, else an own address on the list, else the account address. */
function invitedAddress(invite: ParsedInvite, account: Account): Address {
  const wanted = invite.invitedAs?.address.toLowerCase();
  const own = new Set([account.email, ...account.aliases].map((a) => a.toLowerCase()));
  const guest = invite.attendees.find((a) => a.address === wanted) ?? invite.attendees.find((a) => a.isYou || own.has(a.address));
  if (guest) return { name: guest.name || account.name, address: guest.address };
  return { name: account.name, address: wanted ?? account.email };
}

/** Runs a calendar attempt. False when the event is not on that calendar (invited at another address, or not filed yet): answer by mail instead. */
async function attempt(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (e) {
    if (e instanceof FlintError && e.code === "not_found") return false;
    throw e;
  }
}

/** CalDAV failures after which the iMIP mail reply is still the way to answer. */
const CALDAV_FALLBACK: ReadonlySet<FlintError["code"]> = new Set(["network", "permission", "auth", "invalid"]);

/** Why a reply cannot go to the organizer by mail, or null when it can. */
function unmailable(ctx: ServiceContext, invite: ParsedInvite): string | null {
  if (!invite.organizer?.address) return "This invitation has no organizer to reply to.";
  if (ctx.store.ownAddresses().has(invite.organizer.address.toLowerCase())) return "You organized this event, so there is no one to reply to.";
  return null;
}

async function viaImip(ctx: ServiceContext, account: Account, stored: StoredInvite, response: RsvpResponse, note: string | undefined): Promise<void> {
  const send = ctx.invites.sendImip ?? realSendImip(ctx);
  const attendee = invitedAddress(stored.invite, account);
  const built = buildImipReply({ invite: stored.invite, attendee, response, ...(note ? { note } : {}), now: ctx.now() });
  try {
    await send(account, { ...built, from: attendee });
  } catch (e) {
    if (e instanceof FlintError) throw e;
    log.warn("could not send the invitation reply", { reason: (e as Error).message });
    throw new FlintError("network", `Couldn't send your reply to ${built.to.address}. ${(e as Error).message}`);
  }
}

/** rsvp(messageId, response, note?): Google Calendar API when the account has the scope, else an iMIP REPLY by mail. */
export function createRsvp(ctx: ServiceContext, deps: RsvpDeps) {
  const store = inviteStore(ctx);
  const inFlight = new Map<string, Promise<Invite>>();

  async function run(messageId: MessageRowId, response: RsvpResponse, rawNote: string | undefined): Promise<Invite> {
    const stored = store.getStoredInvite(messageId);
    if (!stored) throw new FlintError("not_found", "That message has no invitation.");
    const merged = await deps.reload(messageId);
    if (!merged) throw new FlintError("not_found", "That message has no invitation.");
    const note = rawNote?.trim() || undefined;
    const { invite } = stored;
    const recurrenceId = invite.recurrenceId ?? "";
    const previous = store.getResponse(stored.accountId, invite.uid, recurrenceId);
    // Same answer, same note, same version of the event: already done, send nothing twice.
    if (previous && previous.response === response && (previous.note ?? undefined) === note && previous.sequence === invite.sequence) return merged;
    const why = refusal(merged);
    if (why) throw new FlintError("invalid", why);

    const account = ctx.store.requireAccount(stored.accountId);
    // The calendar that covers the invited address answers (Google API or CalDAV); otherwise, or when that calendar does not
    // have the event, an iMIP reply goes out by mail.
    const route = resolveRoute(ctx.store, account, invite);
    let via: StoredResponse["via"] = "imip";
    let mail = true;
    let mailOptional = false;
    if (route.kind === "google") {
      // An event Google never saw (the invitation came to another inbox) is added from the invitation, except on a no and
      // for a single occurrence of a series. Adding it tells the organizer nothing, so the answer still goes by mail.
      const opts = { addIfMissing: response !== "declined" && !invite.recurrenceId };
      let imported = false;
      const done = await attempt(async () => {
        const out = route.via === "mail"
          ? await rsvpViaGoogle(ctx, route.account, invite, response, note, opts)
          : await rsvpViaGoogleCalendar(ctx, route.row, account, invite, response, note, opts);
        imported = Boolean(out.imported);
      });
      if (done) { via = "google-calendar"; mail = imported; mailOptional = imported; }
    } else if (route.kind === "caldav") {
      const row = route.row;
      let address = "";
      let done = false;
      try {
        done = await attempt(async () => { address = (await rsvpViaCalDav(ctx, row, stored, selfAddressesOf(account, invite, row), response)).address; });
      } catch (e) {
        // The calendar server is down, read-only or rejected the password: the mail reply still works, so answer that way
        // (rsvpViaCalDav has already flagged a rejected password on the calendar). Nothing to mail: show the calendar's error.
        if (!(e instanceof FlintError) || !CALDAV_FALLBACK.has(e.code) || unmailable(ctx, invite)) throw e;
        log.warn("calendar server unavailable, answering by mail", { calendar: row.id, code: e.code });
      }
      if (done) {
        // A server that does scheduling (RFC 6638) and knows this address as the user's tells the organizer itself; its reply
        // cannot carry the person's note, so a note also goes by mail.
        via = "caldav";
        mail = !serverReplies(row, address) || Boolean(note);
        mailOptional = true;
      }
    }
    if (mail) {
      const why = unmailable(ctx, invite);
      if (why && !mailOptional) throw new FlintError("invalid", why);
      if (!why) await viaImip(ctx, account, stored, response, note);
    }
    store.setResponse({ accountId: stored.accountId, uid: invite.uid, recurrenceId, response, note: note ?? null, via, sequence: invite.sequence, respondedAt: ctx.now() });
    const fresh = await deps.reload(messageId);
    return fresh ?? merged;
  }

  return async (messageId: MessageRowId, response: RsvpResponse, note?: string): Promise<Invite> => {
    if (!["accepted", "tentative", "declined"].includes(response)) throw new FlintError("invalid", "Answer yes, maybe or no.");
    if (note !== undefined && note.length > 2000) throw new FlintError("invalid", "Keep the note under 2000 characters.");
    const key = `${messageId}:${response}:${note ?? ""}`;
    const pending = inFlight.get(key);
    if (pending) return pending; // a double click shares the one send
    const p = run(messageId, response, note).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  };
}
