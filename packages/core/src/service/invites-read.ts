// Reading side of calendar invitations: parse on demand, merge with the user's response and the other versions of the
// event, and shape the message view, the thread-row chip and the upcoming list. Sending (RSVP) lives in invites-google/-imip.
import { INVITE_PARSER_VERSION, type StoredInvite } from "../calendar/contracts";
import { MAX_ICS_BYTES, decodeIcs, isCalendarAttachment, ownAddressesOf, parseAndStore } from "../calendar/capture";
import { allDayToday, mergeInvite } from "../calendar/merge";
import { localZone } from "../calendar/zones";
import { logger } from "../log";
import { resolveRoute } from "./calendarRouting";
import type { AccountId, Invite, InviteChip, InviteListItem, MessageRowId, MessageView, ThreadId } from "../types";
import { FlintError } from "../types";
import type { ServiceContext } from "./context";

const log = logger("service.invites");
/** How long opening a thread waits for calendar parts to download before showing the card later. */
export const INVITE_WAIT_MS = 1_500;

const inflight = new Map<MessageRowId, Promise<StoredInvite | null>>();

/** Re-reads a stored invite with the current parser when it was written by an older one. */
function refreshed(ctx: ServiceContext, stored: StoredInvite): StoredInvite {
  if (stored.parserVersion >= INVITE_PARSER_VERSION) return stored;
  const account = ctx.store.getAccount(stored.accountId);
  if (!account) return stored;
  return parseAndStore(stored.ics, { store: ctx.store, accountId: stored.accountId, messageId: stored.messageId, ownAddresses: ownAddressesOf(account), now: ctx.now() }) ?? stored;
}

async function downloadAndParse(ctx: ServiceContext, messageId: MessageRowId): Promise<StoredInvite | null> {
  const { store } = ctx;
  const message = store.getMessage(messageId);
  const account = message ? store.getAccount(message.accountId) : null;
  if (!message || !account) return null;
  const parts = store.calendarAttachments(messageId).filter((p) => p.size <= MAX_ICS_BYTES).slice(0, 3);
  for (const part of parts) {
    let data: Buffer;
    try {
      data = await ctx.syncs.get(message.accountId).fetchAttachment(part.id);
    } catch (error) {
      log.debug("could not download a calendar part", { messageId, reason: (error as Error).message });
      return null; // not marked as scanned: try again next time
    }
    const parsed = parseAndStore(decodeIcs(data), { store, accountId: message.accountId, messageId, ownAddresses: ownAddressesOf(account), now: ctx.now() });
    if (parsed) return parsed;
  }
  store.markInviteChecked([messageId]);
  return null;
}

/** The stored invite of a message, parsing it first (downloading the calendar part) when it has not been looked at. */
export function ensureInvite(ctx: ServiceContext, messageId: MessageRowId): Promise<StoredInvite | null> {
  const stored = ctx.store.getStoredInvite(messageId);
  if (stored) return Promise.resolve(refreshed(ctx, stored));
  if (ctx.store.isInviteChecked(messageId)) return Promise.resolve(null);
  let work = inflight.get(messageId);
  if (!work) {
    work = downloadAndParse(ctx, messageId).finally(() => inflight.delete(messageId));
    inflight.set(messageId, work);
  }
  return work;
}

/**
 * Makes sure the messages that carry a calendar part have their invite parsed. The UI waits a moment (INVITE_WAIT_MS) and
 * hears about the rest through mail_changed; agents wait for all of it.
 */
export async function ensureInvitesFor(ctx: ServiceContext, messages: readonly Pick<MessageView, "id" | "attachments" | "accountId" | "threadId">[]): Promise<void> {
  const todo = messages.filter((m) => m.attachments.some(isCalendarAttachment) && !ctx.store.getStoredInvite(m.id) && !ctx.store.isInviteChecked(m.id));
  if (todo.length === 0) return;
  const work = Promise.all(todo.map((m) => ensureInvite(ctx, m.id).catch(() => null)));
  if (ctx.caller()) { await work; return; }
  let timer: NodeJS.Timeout | undefined;
  const settled = await Promise.race([work.then(() => true), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), INVITE_WAIT_MS); timer.unref(); })]);
  clearTimeout(timer);
  if (!settled) {
    void work.then(() => { for (const m of todo) ctx.emit({ type: "mail_changed", accountId: m.accountId, threadIds: [m.threadId] }); });
  }
}

/** Merges a stored invite with its other versions and the user's answer. Synchronous: everything is local. */
export function mergedInvite(ctx: ServiceContext, stored: StoredInvite): Invite {
  const { store } = ctx;
  const account = store.requireAccount(stored.accountId);
  const key = stored.invite.recurrenceId ?? "";
  const versions = store.invitesForEvent(stored.accountId, stored.invite.uid, key);
  if (!versions.some((v) => v.messageId === stored.messageId)) versions.push(stored);
  const response = store.getResponse(stored.accountId, stored.invite.uid, key) ?? (key ? store.getResponse(stored.accountId, stored.invite.uid, "") : null);
  const route = resolveRoute(store, account, stored.invite);
  const calendarVia = route.kind === "caldav" ? "caldav" : route.kind === "google" && route.via === "calendar" ? "google-calendar" : null;
  return mergeInvite({ stored, versions, response }, { now: ctx.now(), ownAddresses: ownAddressesOf(account), account, calendarVia });
}

/** The merged invite for a message from what is already stored (no download). Null when the message has none. */
export function inviteFromStore(ctx: ServiceContext, messageId: MessageRowId): Invite | null {
  const stored = ctx.store.getStoredInvite(messageId);
  return stored ? mergedInvite(ctx, refreshed(ctx, stored)) : null;
}

/** FlintApi.getInvite. */
export async function getInvite(ctx: ServiceContext, messageId: MessageRowId): Promise<Invite | null> {
  if (!ctx.store.getMessage(messageId)) throw new FlintError("not_found", "That message no longer exists.");
  const stored = await ensureInvite(ctx, messageId);
  return stored ? mergedInvite(ctx, stored) : null;
}

/** Adds the invite to a message view when the message has one stored. */
export function withInvite(ctx: ServiceContext, view: MessageView): MessageView {
  const invite = inviteFromStore(ctx, view.id);
  return invite ? { ...view, invite } : view;
}

// ---------- thread row chip ----------

export const chipOf = (invite: Invite, messageId: MessageRowId): InviteChip => ({
  uid: invite.uid, method: invite.method, title: invite.title, start: invite.start, end: invite.end, allDay: invite.allDay,
  startDate: invite.startDate, state: invite.state, yourResponse: invite.yourResponse,
  organizerName: invite.reply ? invite.reply.from.name || invite.reply.from.address : invite.organizer ? invite.organizer.name || invite.organizer.address : null,
  messageId,
});

/** How much a chip matters on a row: a coming invite beats a reply or counter, which beat anything finished. */
const weight = (state: Invite["state"]): number => (state === "new" || state === "updated" ? 3 : state === "reply" || state === "counter" ? 2 : state === "superseded" ? 0 : 1);

/** The one invitation per thread that the row shows. Threads with none are absent from the map. */
export function chipsForThreads(ctx: ServiceContext, threadIds: readonly ThreadId[]): Map<ThreadId, InviteChip> {
  const out = new Map<ThreadId, InviteChip>();
  if (threadIds.length === 0) return out;
  const best = new Map<ThreadId, { chip: InviteChip; score: number; date: number }>();
  for (const row of ctx.store.invitesForThreads([...threadIds])) {
    let invite: Invite;
    try {
      invite = mergedInvite(ctx, refreshed(ctx, row));
    } catch (error) {
      log.debug("skipped an invite for the thread chip", { messageId: row.messageId, reason: (error as Error).message });
      continue;
    }
    const score = weight(invite.state);
    const current = best.get(row.threadId);
    const sooner = current !== undefined && score === 3 && current.score === 3 && invite.start < current.chip.start;
    const better = !current || score > current.score || sooner || (score === current.score && score < 3 && row.messageDate >= current.date);
    if (better) best.set(row.threadId, { chip: chipOf(invite, row.messageId), score, date: row.messageDate });
  }
  for (const [id, b] of best) out.set(id, b.chip);
  return out;
}

// ---------- upcoming list ----------

const DEFAULT_LIST = 50;

/** FlintApi.listInvites: coming invitations (new or updated, newest version per event), soonest first. */
export async function listInvites(ctx: ServiceContext, opts: { accountId?: AccountId; from?: number; to?: number; limit?: number } = {}): Promise<InviteListItem[]> {
  const from = opts.from ?? ctx.now();
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_LIST, 200));
  const rows = ctx.store.upcomingInvites({ ...(opts.accountId ? { accountId: opts.accountId } : {}), from, to: opts.to ?? null, limit: limit * 4 + 50 });
  const items: InviteListItem[] = [];
  for (const row of rows) {
    const message = ctx.store.getMessage(row.messageId);
    if (!message) continue;
    const invite = mergedInvite(ctx, refreshed(ctx, row));
    if (invite.state !== "new" && invite.state !== "updated") continue;
    if ((invite.allDay ? invite.end <= allDayToday(from, localZone()) : invite.end < from) || (opts.to !== undefined && invite.start >= opts.to)) continue;
    items.push({ threadId: message.threadId, accountId: row.accountId, subject: message.subject, invite: chipOf(invite, row.messageId) });
  }
  items.sort((a, b) => a.invite.start - b.invite.start || a.invite.messageId - b.invite.messageId);
  return items.slice(0, limit);
}

// ---------- catch-up for older mail ----------

const BACKFILL_BATCH = 25;
/** A message whose download failed is left alone this long, so a few unreachable ones cannot starve older mail. */
const BACKFILL_RETRY_MS = 6 * 60 * 60 * 1000;
const BACKFILL_SCAN = 500;

/**
 * Parses the invitations of mail that arrived before this feature or whose body was never fetched, newest first. Messages that
 * cannot be downloaded now stay unscanned and are tried again after BACKFILL_RETRY_MS, while older messages go ahead of them.
 * Returns how many invitations were found.
 */
export async function backfillInvites(ctx: ServiceContext, maxMessages = BACKFILL_BATCH): Promise<number> {
  let found = 0;
  const touched = new Map<ThreadId, AccountId>();
  const triedKey = (id: MessageRowId): string => `inviteBackfillTried:${id}`;
  const candidates = ctx.store.uncheckedInviteMessages(BACKFILL_SCAN).filter((m) => ctx.store.kvGet(triedKey(m.messageId), ctx.now()) === null);
  for (const { messageId, accountId } of candidates.slice(0, maxMessages)) {
    const stored = await ensureInvite(ctx, messageId).catch(() => null);
    const message = ctx.store.getMessage(messageId);
    if (stored && message) { found += 1; touched.set(message.threadId, accountId); }
    else if (!ctx.store.isInviteChecked(messageId)) ctx.store.kvSet(triedKey(messageId), "1", BACKFILL_RETRY_MS, ctx.now());
  }
  for (const [threadId, accountId] of touched) ctx.emit({ type: "mail_changed", accountId, threadIds: [threadId] });
  return found;
}
