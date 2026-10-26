import type { FlintApi } from "../api";
import { CODE_CLIPBOARD_CLEAR_MS, CODE_MAX_AGE_MS, CODE_TTL_MS, codesPaths } from "../codes/contract";
import { detectCode, senderDomainOf } from "../codes/detect";
import { startCodesServer, type CodesServerHandle } from "../codes/server";
import { logger } from "../log";
import { senderMatchesBlocked } from "../rules";
import type { CodeBadge, FlintEvent, MessageRowId, Settings, ThreadId, VerificationCode } from "../types";
import type { ServiceContext } from "./context";
import { soundFor } from "./notifyPolicy";

const log = logger("service.codes");

const SKIP_ROLES = new Set(["spam", "trash", "sent", "drafts"]);
/** Mail dated further ahead than this is not "just arrived". */
const FUTURE_SLACK_MS = 10 * 60_000;
const MAX_REMEMBERED = 500;
/** The normal new-mail alert for a thread is dropped when a code alert for it was raised this recently. */
const ALERT_COVER_MS = 10_000;

/** OWNER: detector. recentCodes and markCodeUsed. All five code methods are "admin" tier, so agents never reach them. */
export type CodesApi = Pick<FlintApi, "recentCodes" | "markCodeUsed">;

export const toBadge = (c: VerificationCode): CodeBadge => ({ id: c.id, code: c.code, service: c.service, expiresAt: c.expiresAt, used: c.used });

export function codesApi(ctx: ServiceContext): CodesApi {
  return {
    async recentCodes() {
      return ctx.codes.list({ includeUsed: true });
    },
    async markCodeUsed(id) {
      markUsed(ctx, id);
    },
  };
}

function markUsed(ctx: ServiceContext, id: string): void {
  const code = ctx.codes.get(id);
  if (!code || !ctx.codes.markUsed(id)) return;
  ctx.emit({ type: "mail_changed", accountId: code.accountId, threadIds: [code.threadId] });
}

/** Badge for a thread/message, only for the Flint app itself (agents read mail but not the code index). */
export function badgeFor(ctx: ServiceContext, by: { threadId: ThreadId } | { messageId: MessageRowId }): CodeBadge | undefined {
  if (ctx.caller() !== undefined) return undefined;
  const code = "messageId" in by ? ctx.codes.forMessage(by.messageId) : ctx.codes.forThread(by.threadId);
  return code ? toBadge(code) : undefined;
}

/** Code alerts follow the same switches as ordinary new-mail alerts: the master switch, scope "none" and per-account mute. */
function alertsAllowed(settings: Settings, accountId: string): boolean {
  const n = settings.notifications;
  return n.enabled && n.scope !== "none" && !n.disabledAccounts.includes(accountId);
}

/** True when a code alert for this thread was just shown, so the ordinary new-mail alert would only repeat it. */
export function codeAlertCovers(ctx: ServiceContext, threadId: ThreadId): boolean {
  const s = ctx.getSettings().codes;
  if (!s.enabled || !s.notify || ctx.getSettings().notifications.preview === "none") return false;
  const code = ctx.codes.forThread(threadId);
  return code !== null && alertsAllowed(ctx.getSettings(), code.accountId) && ctx.now() - (code.expiresAt - CODE_TTL_MS) <= ALERT_COVER_MS;
}

function announce(ctx: ServiceContext, code: VerificationCode): void {
  const settings = ctx.getSettings();
  ctx.emit({ type: "code", code } satisfies FlintEvent);
  // With previews off a code must not appear in a notification; the ordinary new-mail alert shows instead.
  if (settings.codes.notify && settings.notifications.preview !== "none" && alertsAllowed(settings, code.accountId)) {
    try {
      ctx.platform.notify({
        title: `${code.service} code ${code.code}`,
        body: code.senderAddress,
        threadId: code.threadId,
        group: `code-${code.threadId}`,
        copyText: code.code,
        sound: soundFor(settings.notifications),
      });
    } catch (error) {
      log.warn("could not show a code notification", { reason: (error as Error).message });
    }
  }
  // Auto-copy is its own setting, but it must not put a code on the clipboard (and clipboard history) when previews are off
  // or the account is muted.
  if (settings.codes.autoCopy && settings.notifications.preview !== "none" && !settings.notifications.disabledAccounts.includes(code.accountId)) {
    try {
      ctx.platform.copyText?.(code.code, CODE_CLIPBOARD_CLEAR_MS);
    } catch (error) {
      log.warn("could not copy a code", { reason: (error as Error).message });
    }
  }
}

/** Looks at the thread's fresh unread messages and registers a code for each one that has one. */
function scanThread(ctx: ServiceContext, threadId: ThreadId, seen: Set<MessageRowId>): void {
  const { store } = ctx;
  const rows = store.getThreadRows(threadId);
  if (!rows) return;
  const now = ctx.now();
  const blocked = store.blockedPatterns();
  const fresh = rows.messages.filter((m) =>
    !seen.has(m.id) && !m.seen && !m.draft && !m.isFromMe && !m.inSent &&
    m.date >= now - CODE_MAX_AGE_MS && m.date <= now + FUTURE_SLACK_MS &&
    !m.from.some((a) => senderMatchesBlocked(a.address, blocked)));
  if (fresh.length === 0) return;
  const roles = new Map(store.getMessageLocations(fresh.map((m) => m.id)).map((l) => [l.messageRowId, l.folderRole]));
  for (const m of fresh) {
    seen.add(m.id);
    if (seen.size > MAX_REMEMBERED) seen.delete(seen.values().next().value as number);
    const role = roles.get(m.id);
    if (role && SKIP_ROLES.has(role)) continue;
    const from = m.from[0] ?? { name: "", address: "" };
    const found = detectCode({ subject: m.subject, text: m.text, html: m.rawHtml, fromName: from.name || null, fromAddress: from.address });
    if (!found) continue;
    announce(ctx, ctx.codes.add({
      code: found.code, service: found.service, senderAddress: from.address, senderDomain: senderDomainOf(from.address),
      threadId: m.threadId, messageId: m.id, accountId: m.accountId, receivedAt: m.date,
    }));
  }
}

/**
 * Starts code detection and the codes socket for this service; returns the stop function. Detection runs when new inbox mail
 * is announced (the sync already filtered folders, blocked senders and mail from the user; the thread scan repeats those
 * checks and adds the 15 minute age rule). Behaviour per settings.codes: `enabled` gates everything, `notify` the notification,
 * `autoCopy` the clipboard.
 */
export function wireCodes(ctx: ServiceContext, opts: { startSocket?: boolean } = {}): () => void {
  const seen = new Set<MessageRowId>();
  const unsubscribe = ctx.bus.subscribe((event) => {
    if (event.type !== "new_mail" || !ctx.getSettings().codes.enabled) return;
    try {
      scanThread(ctx, event.threadId, seen);
    } catch (error) {
      log.warn("code detection failed", { reason: (error as Error).message });
    }
  });

  let server: CodesServerHandle | null = null;
  let stopped = false;
  if (opts.startSocket) {
    startCodesServer({
      paths: codesPaths(ctx.platform.dataDir),
      registry: ctx.codes,
      isEnabled: () => ctx.getSettings().codes.enabled,
      onUsed: (code) => ctx.emit({ type: "mail_changed", accountId: code.accountId, threadIds: [code.threadId] }),
    }).then(
      (handle) => { if (stopped) void handle.close(); else server = handle; },
      (error: Error) => log.warn("codes socket did not start", { reason: error.message }),
    );
  }

  return () => {
    stopped = true;
    unsubscribe();
    void server?.close();
    server = null;
    ctx.codes.clear();
  };
}
