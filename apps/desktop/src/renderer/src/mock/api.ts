import { FlintError } from "@flint/core/types";
import type {
  Account, AccountId, AddAccountInput, DeepPartial, FlintApi, FlintEvent, Folder, HomeData, Signature,
  MessageView, ServerConfig, Settings, SidebarData, SyncStatus, ThreadDetail, ThreadId, ThreadQuery,
} from "@flint/core";
import { streamFakeAi, fakeAiText } from "./ai";
import { approveSend, cancelSend, createDraft, deleteDraft, getDraft, sendDraft, updateDraft, type Ctx } from "./compose";
import { mockAddCalDav, mockAddGoogleCalendar, mockListCalendars, mockRemoveCalendar, mockUpdateCalendar, refreshInviteRoutes } from "./calendars";
import { mockConflicts, mockListInvites, mockRsvp } from "./invites";
import { ALL_CONTACTS } from "./people";
import { mockAvatarApi } from "./avatars";
import { mockCategoryApi } from "./categories";
import { mockSparkApi } from "./spark";
import { buildState } from "./seed";
import { deepMerge, liveDrafts, nextId, type MThread, type MockState } from "./state";
import { hiddenAccounts, isQueuedDraft, matchesSearch, parseSearch, queryThreads, sortedOlder, unreadCount, withCode } from "./threads";

export type MockOptions = { now?: number; seed?: number; latencyMs?: number };

const DAY = 86_400_000;
const OLDER_BATCH = 25;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Stateful in-memory FlintApi with realistic fixtures. Mutations update state and emit the same
 * events the real service does, so screens behave live in the browser preview and in tests.
 */
export function createMockApi(opts: MockOptions = {}): FlintApi {
  const t0 = opts.now ?? Date.now();
  const startedAt = Date.now();
  const now = () => t0 + (Date.now() - startedAt);
  const latency = opts.latencyMs ?? 0;
  const state: MockState = buildState(t0, opts.seed);
  const listeners = new Set<(e: FlintEvent) => void>();
  const emit = (e: FlintEvent) => listeners.forEach((l) => l(e));
  const ctx: Ctx = { state, now, emit, timers: new Map() };
  const undo = new Map<string, () => void>();
  const aiRuns = new Map<string, () => void>();

  const delay = () => (latency > 0 ? sleep(latency) : Promise.resolve());
  const find = (id: ThreadId): MThread => {
    const t = state.threads.find((x) => x.id === id);
    if (!t) throw new FlintError("not_found", "That conversation no longer exists.");
    return t;
  };
  const changed = (ids: ThreadId[]) => {
    const byAccount = new Map<AccountId, ThreadId[]>();
    for (const t of state.threads) if (ids.includes(t.id)) byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t.id]);
    for (const [accountId, threadIds] of byAccount) emit({ type: "mail_changed", accountId, threadIds });
  };
  /** Applies `fn` to the threads, emits mail_changed and returns an undo token that restores them. */
  const mutate = (ids: ThreadId[], fn: (t: MThread) => MThread): { undoToken: string } => {
    const before = state.threads.filter((t) => ids.includes(t.id));
    state.threads = state.threads.map((t) => (ids.includes(t.id) ? fn(t) : t));
    const token = `undo_${nextId(state, "undo")}`;
    undo.set(token, () => {
      state.threads = state.threads.map((t) => before.find((b) => b.id === t.id) ?? t);
      changed(ids);
    });
    changed(ids);
    return { undoToken: token };
  };
  const setLocation = (ids: ThreadId[], location: MThread["location"]) => mutate(ids, (t) => ({ ...t, location, snoozedUntil: location === "inbox" ? t.snoozedUntil : null }));
  const findMessage = (id: number): MessageView => {
    for (const t of state.threads) {
      const m = t.messages.find((x) => x.id === id);
      if (m) return m;
    }
    throw new FlintError("not_found", "That message no longer exists.");
  };
  const replaceMessage = (id: number, fn: (m: MessageView) => MessageView): MessageView => {
    let out: MessageView | undefined;
    state.threads = state.threads.map((t) => {
      if (!t.messages.some((m) => m.id === id)) return t;
      return { ...t, messages: t.messages.map((m) => (m.id === id ? (out = fn(m)) : m)) };
    });
    if (!out) throw new FlintError("not_found", "That message no longer exists.");
    return out;
  };
  const folderCounts = (f: Folder): Folder => {
    const inFolder = state.threads.filter((t) => t.accountId === f.accountId && (f.role ? (f.role === "inbox" ? t.location === "inbox" : f.role === "sent" ? t.messages.some((m) => m.isFromMe) : f.role === "drafts" ? t.draftIds.length > 0 : t.location === f.role) : t.folderIds.includes(f.id)));
    return { ...f, total: inFolder.length, unread: f.role === "drafts" || f.role === "sent" ? 0 : inFolder.filter((t) => unreadCount(t) > 0).length };
  };
  const syncSet = (accountId: AccountId | undefined, s: Partial<SyncStatus>) => {
    state.sync = state.sync.map((x) => (!accountId || x.accountId === accountId ? { ...x, ...s } : x));
    for (const x of state.sync) if (!accountId || x.accountId === accountId) emit({ type: "sync", status: x });
  };
  const requireAi = () => {
    if (!state.ai.connected || !state.settings.ai.enabled) throw new FlintError("ai_not_connected", "Connect ChatGPT or Grok in Settings → +AI.");
  };

  const api: FlintApi = {
    // Accounts
    async listAccounts() { await delay(); return [...state.accounts].sort((a, b) => a.sortOrder - b.sortOrder); },
    async autoconfig(email) {
      const domain = email.split("@")[1]?.toLowerCase();
      if (!domain || !domain.includes(".")) return null;
      const gmail = domain === "gmail.com" || domain === "googlemail.com";
      const cfg: ServerConfig = gmail
        ? { imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, username: email }
        : { imapHost: `imap.${domain}`, imapPort: 993, imapSecure: true, smtpHost: `smtp.${domain}`, smtpPort: 587, smtpSecure: false, username: email };
      return cfg;
    },
    async testConnection(input) {
      await delay();
      if (!input.password) return { imap: "Password is empty.", smtp: "ok" };
      return { imap: "ok", smtp: "ok" };
    },
    async addAccount(input: AddAccountInput) {
      await delay();
      if (state.accounts.some((a) => a.email.toLowerCase() === input.email.toLowerCase())) throw new FlintError("conflict", `${input.email} is already added.`);
      const cfg = input.server ?? (await api.autoconfig(input.email)) ?? { imapHost: "", imapPort: 993, imapSecure: true, smtpHost: "", smtpPort: 587, smtpSecure: false, username: input.email };
      const account: Account = {
        ...cfg, id: `acc_${nextId(state, "account")}x`, email: input.email, name: input.name, provider: input.provider ?? "imap", authKind: "password", color: "#8f7fb5",
        sortOrder: state.accounts.length, enabled: true, aliases: [], createdAt: now(), showInUnified: true, avatarSource: null, avatarUpdatedAt: null, calendarScope: false,
      };
      state.accounts = [...state.accounts, account];
      const roles = [["inbox", "Inbox"], ["sent", "Sent"], ["drafts", "Drafts"], ["archive", "Archive"], ["trash", "Trash"], ["spam", "Spam"]] as const;
      state.folders = [...state.folders, ...roles.map(([role, name]) => ({ id: nextId(state, "folder"), accountId: account.id, path: name, name, role, unread: 0, total: 0 }))];
      state.sync = [...state.sync, { accountId: account.id, state: "idle", lastSyncAt: now() }];
      emit({ type: "mail_changed", accountId: account.id, threadIds: [] });
      return account;
    },
    async addGoogleAccount() {
      await sleep(Math.max(latency, 600));
      return api.addAccount({ email: `new.account${state.accounts.length}@gmail.com`, name: "Alex Rivera", password: "oauth", provider: "gmail" });
    },
    async updateAccount(id, patch) {
      const current = state.accounts.find((a) => a.id === id);
      if (!current) throw new FlintError("not_found", "That account no longer exists.");
      const next = { ...current, ...patch };
      state.accounts = state.accounts.map((a) => (a.id === id ? next : a));
      emit({ type: "mail_changed", accountId: id, threadIds: [] });
      return next;
    },
    async removeAccount(id) {
      state.accounts = state.accounts.filter((a) => a.id !== id);
      state.threads = state.threads.filter((t) => t.accountId !== id);
      state.folders = state.folders.filter((f) => f.accountId !== id);
      state.drafts = state.drafts.filter((d) => d.accountId !== id);
      state.sync = state.sync.filter((s) => s.accountId !== id);
      emit({ type: "mail_changed", accountId: id, threadIds: [] });
    },

    // Sync
    async syncNow(accountId) {
      syncSet(accountId, { state: "syncing", progress: { done: 40, total: 120, folder: "INBOX" } });
      await sleep(Math.max(latency, 700));
      syncSet(accountId, { state: "idle", lastSyncAt: now(), progress: undefined });
    },
    async getSyncStatus() { return state.sync; },

    // Navigation and reading
    async getSidebar(): Promise<SidebarData> {
      await delay();
      const inboxThreads = state.threads.filter((t) => t.location === "inbox" && !t.blocked && !(t.snoozedUntil && t.snoozedUntil > now()));
      const hidden = hiddenAccounts(state);
      const shown = (t: { accountId: string }) => !hidden.has(t.accountId);
      const accounts = [...state.accounts].sort((a, b) => a.sortOrder - b.sortOrder).map((account) => ({
        account,
        inboxUnread: inboxThreads.filter((t) => t.accountId === account.id && unreadCount(t) > 0).length,
        folders: state.folders.filter((f) => f.accountId === account.id).map(folderCounts),
        sync: state.sync.find((s) => s.accountId === account.id) ?? { accountId: account.id, state: "idle" as const },
      }));
      return {
        accounts,
        counts: {
          inbox: inboxThreads.filter((t) => shown(t) && unreadCount(t) > 0).length,
          pinned: state.threads.filter((t) => shown(t) && t.pinned && t.location !== "trash").length,
          drafts: liveDrafts(state).filter(shown).length,
          snoozed: state.threads.filter((t) => shown(t) && t.snoozedUntil && t.snoozedUntil > now()).length,
          scheduled: state.scheduled.filter((s) => s.status === "pending" || s.status === "awaiting_approval").length,
          awaitingApproval: state.scheduled.filter((s) => s.status === "awaiting_approval").length,
          spam: state.threads.filter((t) => shown(t) && t.location === "spam").length,
        },
      };
    },
    async getHome(): Promise<HomeData> {
      await delay();
      const q = (view: ThreadQuery["view"], extra: Partial<ThreadQuery> = {}) => queryThreads(state, { view, limit: 5, ...extra }, now()).items;
      const awaiting = queryThreads(state, { view: "sent", limit: 40 }, now()).items.filter((i) => i.receipt && i.receipt.status !== "replied").slice(0, 5);
      const hidden = hiddenAccounts(state);
      return {
        greetingName: "Alex",
        unreadPeople: q("inbox", { focused: true, unreadOnly: true }),
        pinned: q("pinned"),
        awaitingReply: awaiting,
        recentReceipts: [...state.tracked].sort((a, b) => b.sentAt - a.sentAt).slice(0, 5),
        snoozedToday: state.threads.filter((t) => !hidden.has(t.accountId) && t.snoozedUntil && t.snoozedUntil > now() && t.snoozedUntil < now() + DAY).length,
        scheduledCount: state.scheduled.filter((s) => s.status === "pending" || s.status === "awaiting_approval").length,
      };
    },
    async listThreads(query) { await delay(); return queryThreads(state, query, now()); },
    async loadOlder(query) {
      await sleep(Math.max(latency, 600));
      const batch = sortedOlder(state, query.accountId).slice(0, OLDER_BATCH);
      state.threads = [...state.threads, ...batch];
      state.older = state.older.filter((t) => !batch.includes(t));
      changed(batch.map((t) => t.id));
      return { loaded: batch.length, hasMore: sortedOlder(state, query.accountId).length > 0 };
    },
    async searchServer(search, accountId) {
      await sleep(Math.max(latency, 900));
      const terms = parseSearch(search);
      const hits = sortedOlder(state, accountId).filter((t) => matchesSearch(state, t, terms));
      state.threads = [...state.threads, ...hits];
      state.older = state.older.filter((t) => !hits.includes(t));
      changed(hits.map((t) => t.id));
      return { found: hits.length, added: hits.length };
    },
    async getThread(id): Promise<ThreadDetail> {
      await delay();
      const t = find(id);
      return { id: t.id, accountId: t.accountId, subject: t.subject, category: t.category, pinned: t.pinned, muted: t.muted, snoozedUntil: t.snoozedUntil, messages: t.messages.map((m) => withCode(state, m)), draftIds: t.draftIds.filter((d) => !isQueuedDraft(state, d)),
        outgoing: state.scheduled
          .filter((j) => t.draftIds.includes(j.draftId) && (j.status === "pending" || j.status === "awaiting_approval" || j.status === "sending"))
          .map((j) => ({ scheduledId: j.id, draftId: j.draftId, sendAt: j.sendAt, status: j.status as "pending" | "awaiting_approval" | "sending" })) };
    },
    async getMessage(id) { await delay(); return withCode(state, findMessage(id)); },

    // Calendar invitations
    async getInvite(messageId) { await delay(); return findMessage(messageId).invite ?? null; },
    async rsvp(messageId, response, note) {
      await sleep(Math.max(latency, 350));
      const msg = findMessage(messageId);
      if (!msg.invite) throw new FlintError("not_found", "That message has no invitation.");
      const next = mockRsvp(msg.invite, response, note, now());
      replaceMessage(messageId, (m) => ({ ...m, invite: next }));
      changed([msg.threadId]);
      return next;
    },
    async inviteConflicts(messageId) { await sleep(Math.max(latency, 250)); return mockConflicts(state, messageId, now()); },
    async connectGoogleCalendar(accountId) {
      await sleep(Math.max(latency, 600));
      const current = state.accounts.find((a) => a.id === accountId);
      if (!current) throw new FlintError("not_found", "That account no longer exists.");
      if (current.authKind !== "oauth_google") throw new FlintError("invalid", "Only accounts signed in with Google can connect Google Calendar.");
      const next = { ...current, calendarScope: true };
      state.accounts = state.accounts.map((a) => (a.id === accountId ? next : a));
      state.threads = state.threads.map((t) => t.accountId !== accountId ? t : { ...t, messages: t.messages.map((m) => m.invite?.rsvpVia === "google-needs-scope" ? { ...m, invite: { ...m.invite, rsvpVia: "google-calendar" as const } } : m) });
      refreshInviteRoutes(state);
      emit({ type: "mail_changed", accountId, threadIds: [] });
      return next;
    },
    async listInvites(opts) { await delay(); return mockListInvites(state, opts, now()); },
    async listCalendarAccounts() { await delay(); return mockListCalendars(state); },
    async addGoogleCalendarAccount(input) {
      await sleep(Math.max(latency, 700));
      const added = mockAddGoogleCalendar(state, input, now(), nextId(state, "calendar"));
      refreshInviteRoutes(state);
      emit({ type: "mail_changed", accountId: "", threadIds: [] });
      return added;
    },
    async addCalDavAccount(input) {
      await sleep(Math.max(latency, 900));
      const added = mockAddCalDav(state, input, now(), nextId(state, "calendar"));
      refreshInviteRoutes(state);
      emit({ type: "mail_changed", accountId: "", threadIds: [] });
      return added;
    },
    async updateCalendarAccount(id, patch) {
      await delay();
      const next = mockUpdateCalendar(state, id, patch);
      refreshInviteRoutes(state);
      emit({ type: "mail_changed", accountId: "", threadIds: [] });
      return next;
    },
    async removeCalendarAccount(id) {
      await delay();
      mockRemoveCalendar(state, id);
      refreshInviteRoutes(state);
      emit({ type: "mail_changed", accountId: "", threadIds: [] });
    },
    async allowRemoteImages(id, always) {
      const m = findMessage(id);
      const out = replaceMessage(id, (x) => ({ ...x, remoteImages: "allowed", hasTrackers: always ? false : x.hasTrackers }));
      changed([m.threadId]);
      return out;
    },
    async listFolders(accountId) { return state.folders.filter((f) => f.accountId === accountId).map(folderCounts); },
    async saveAttachment(attachmentId) {
      const a = state.threads.flatMap((t) => t.messages).flatMap((m) => m.attachments).find((x) => x.id === attachmentId);
      if (!a) throw new FlintError("not_found", "That attachment is gone.");
      return `/Users/alex/Downloads/${a.filename}`;
    },
    async openAttachment() { /* no-op in the mock */ },
    async suggestContacts(prefix, limit = 8) {
      const p = prefix.trim().toLowerCase();
      if (!p) return [];
      return ALL_CONTACTS.filter((c) => c.name.toLowerCase().includes(p) || c.address.toLowerCase().startsWith(p))
        .slice(0, limit).map((c, i) => ({ email: c.address, name: c.name, score: 100 - i }));
    },

    // Thread actions
    async markRead(ids, read) {
      return mutate(ids, (t) => ({ ...t, messages: t.messages.map((m) => (m.isFromMe ? m : { ...m, seen: read })) }));
    },
    async setPinned(ids, pinned) { return mutate(ids, (t) => ({ ...t, pinned })); },
    async archive(ids) { return setLocation(ids, "archive"); },
    async trash(ids) { return setLocation(ids, "trash"); },
    async markSpam(ids, spam) { return setLocation(ids, spam ? "spam" : "inbox"); },
    async moveToFolder(ids, folderId) {
      const folder = state.folders.find((f) => f.id === folderId);
      if (!folder) throw new FlintError("not_found", "That folder no longer exists.");
      if (folder.role === "inbox") return setLocation(ids, "inbox");
      if (folder.role === "archive" || folder.role === "trash" || folder.role === "spam") return setLocation(ids, folder.role);
      return mutate(ids, (t) => ({ ...t, location: "archive", folderIds: [...new Set([...t.folderIds, folderId])] }));
    },
    async moveToInbox(ids) { return setLocation(ids, "inbox"); },
    async snooze(ids, until) { return mutate(ids, (t) => ({ ...t, snoozedUntil: until })); },
    async unsnooze(ids) { return mutate(ids, (t) => ({ ...t, snoozedUntil: null, resurfacedAt: now() })); },
    async setMuted(ids, muted) { return mutate(ids, (t) => ({ ...t, muted })); },
    ...mockCategoryApi({ state, mutate }),
    async undo(token) {
      const fn = undo.get(token);
      if (!fn) throw new FlintError("not_found", "Too late to undo that.");
      undo.delete(token);
      fn();
    },
    async unsubscribe(messageId) {
      const u = findMessage(messageId).unsubscribe;
      if (!u) throw new FlintError("invalid", "This message has no unsubscribe link.");
      return { method: u.oneClick ? "one_click" : u.url ? "browser" : "mailto" };
    },

    // Blocked senders
    async blockSender(pattern) {
      state.blocked = [...state.blocked.filter((b) => b.pattern !== pattern), { pattern, createdAt: now() }];
      const p = pattern.toLowerCase();
      const hit = state.threads.filter((t) => t.location === "inbox" && t.messages.some((m) => m.from.some((a) => a.address.toLowerCase().includes(p.replace(/^@/, "")))));
      if (hit.length) mutate(hit.map((t) => t.id), (t) => ({ ...t, location: "trash", blocked: true }));
      else emit({ type: "mail_changed", accountId: state.accounts[0]!.id, threadIds: [] });
    },
    async unblockSender(pattern) {
      state.blocked = state.blocked.filter((b) => b.pattern !== pattern);
      const p = pattern.toLowerCase().replace(/^@/, "");
      const back = state.threads.filter((t) => t.blocked && t.messages.some((m) => m.from.some((a) => a.address.toLowerCase().includes(p))));
      mutate(back.map((t) => t.id), (t) => ({ ...t, location: "inbox", blocked: false }));
    },
    async listBlocked() { return state.blocked; },

    // Compose
    async createDraft(init) { await delay(); return createDraft(ctx, init); },
    async getDraft(id) { return getDraft(ctx, id); },
    async updateDraft(id, patch) { return updateDraft(ctx, id, patch); },
    async deleteDraft(id) { deleteDraft(ctx, id); },
    async listDrafts() { return [...liveDrafts(state)].sort((a, b) => b.updatedAt - a.updatedAt); },
    async openServerDraft(messageId) {
      const thread = state.threads.find((t) => t.messages.some((m) => m.id === messageId));
      const existing = thread?.draftIds[0];
      if (existing !== undefined) return getDraft(ctx, existing);
      return createDraft(ctx, { mode: "reply", messageId });
    },
    async addAttachment(draftId, filePath) {
      const d = getDraft(ctx, draftId);
      const filename = filePath.split("/").pop() ?? "file";
      const ext = filename.split(".").pop()?.toLowerCase() ?? "";
      const contentType = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "application/octet-stream";
      const att = { id: `att_${nextId(state, "att")}`, filename, contentType, size: 48_000, path: filePath };
      state.drafts = state.drafts.map((x) => (x.id === draftId ? { ...d, attachments: [...d.attachments, att] } : x));
      return getDraft(ctx, draftId);
    },
    async removeAttachment(draftId, attachmentId) {
      const d = getDraft(ctx, draftId);
      state.drafts = state.drafts.map((x) => (x.id === draftId ? { ...d, attachments: d.attachments.filter((a) => a.id !== attachmentId) } : x));
      return getDraft(ctx, draftId);
    },
    async sendDraft(id, opts) { return sendDraft(ctx, id, opts); },
    async cancelSend(id) { return cancelSend(ctx, id); },
    async listScheduled() { return state.scheduled.filter((s) => ["pending", "awaiting_approval", "sending", "failed"].includes(s.status)); },
    async approveSend(id, approve) { return approveSend(ctx, id, approve); },

    // Signatures, templates, rules
    async listSignatures() { return state.signatures; },
    async saveSignature(sig) {
      const saved = { ...sig, accountIds: [...new Set(sig.accountIds)], id: sig.id ?? nextId(state, "sig") + 100 };
      if (saved.accountIds.some((id) => !state.accounts.some((a) => a.id === id))) throw new FlintError("invalid", "One of the accounts for that signature doesn't exist.");
      const overlaps = (o: Signature) => o.id !== saved.id && (o.accountIds.length === 0 || saved.accountIds.length === 0 || o.accountIds.some((id) => saved.accountIds.includes(id)));
      const others = state.signatures.filter((s) => s.id !== saved.id).map((o) => (overlaps(o) ? { ...o, defaultNew: o.defaultNew && !saved.defaultNew, defaultReply: o.defaultReply && !saved.defaultReply } : o));
      state.signatures = state.signatures.some((s) => s.id === saved.id)
        ? state.signatures.map((s) => (s.id === saved.id ? saved : (others.find((o) => o.id === s.id) ?? s)))
        : [...others, saved];
      return saved;
    },
    async deleteSignature(id) { state.signatures = state.signatures.filter((s) => s.id !== id); },
    ...mockAvatarApi(state, emit),
    async sendTestNotification() { emit({ type: "toast", level: "info", message: "Test notification sent." }); },
    ...mockSparkApi(state, now, () => nextId(state, "sig") + 100, emit),
    async listTemplates() { return state.templates; },
    async saveTemplate(t) {
      const saved = { ...t, id: t.id ?? nextId(state, "tpl") + 100 };
      state.templates = state.templates.some((x) => x.id === saved.id) ? state.templates.map((x) => (x.id === saved.id ? saved : x)) : [...state.templates, saved];
      return saved;
    },
    async deleteTemplate(id) { state.templates = state.templates.filter((t) => t.id !== id); },
    async listRules() { return [...state.rules].sort((a, b) => a.sortOrder - b.sortOrder); },
    async saveRule(rule) {
      const saved = { ...rule, id: rule.id ?? nextId(state, "rule") + 100 };
      state.rules = state.rules.some((r) => r.id === saved.id) ? state.rules.map((r) => (r.id === saved.id ? saved : r)) : [...state.rules, saved];
      return saved;
    },
    async deleteRule(id) { state.rules = state.rules.filter((r) => r.id !== id); },
    async applyRules() { await sleep(Math.max(latency, 300)); return { changed: 3 }; },

    // Read receipts
    async listTracked(opts) {
      const list = [...state.tracked].sort((a, b) => b.sentAt - a.sentAt)
        .filter((t) => (opts?.status === "opened" ? t.summary.opened > 0 : opts?.status === "unopened" ? t.summary.opened === 0 : true));
      return list.slice(0, opts?.limit ?? 100);
    },
    async getReceipt(id) {
      const r = state.receipts[id];
      if (!r) throw new FlintError("not_found", "That receipt is gone.");
      return r;
    },
    async refreshReceipts() { await sleep(Math.max(latency, 300)); },
    async stopTracking(id) {
      state.tracked = state.tracked.filter((t) => t.trackedId !== id);
      emit({ type: "mail_changed", accountId: state.accounts[0]!.id, threadIds: [] });
    },

    // AI
    async aiStatus() { return { ...state.ai, enabled: state.settings.ai.enabled }; },
    async aiStartConnect(provider) {
      return provider === "codex" ? { url: "https://auth.example.com/codex/authorize", needsPaste: false } : { url: "https://auth.example.com/grok/authorize", needsPaste: true };
    },
    async aiFinishConnect(provider, pasted) {
      if (!pasted.trim()) throw new FlintError("invalid", "Paste the code from the browser.");
      state.ai = { ...state.ai, provider, connected: true, enabled: true };
      return state.ai;
    },
    async aiDisconnect() { state.ai = { ...state.ai, provider: null, connected: false, model: null }; return state.ai; },
    async aiSetModel(model) { state.ai = { ...state.ai, model }; return state.ai; },
    async aiRun(task) {
      requireAi();
      const runId = `run_${nextId(state, "run")}`;
      aiRuns.set(runId, streamFakeAi(state, runId, task, (chunk) => emit({ type: "ai", chunk })));
      return { runId };
    },
    async aiRunToText(task) { if (task.kind !== "needsReply") requireAi(); return { text: fakeAiText(state, task) }; },
    async aiCancel(runId) { aiRuns.get(runId)?.(); aiRuns.delete(runId); },

    // Verification codes (demo: one KAYAK code so the preview shows the UI)
    async recentCodes() { return state.codes; },
    async markCodeUsed(id) { state.codes = state.codes.map((c) => (c.id === id ? { ...c, used: true } : c)); },
    async browserHelperStatus() { return state.helper; },
    async installBrowserHelper() {
      state.helper = { ...state.helper, wrapperInstalled: true, browsers: state.helper.browsers.map((b) => ({ ...b, installed: b.detected && !b.foreign })) };
      return state.helper;
    },
    async removeBrowserHelper() {
      state.helper = { ...state.helper, wrapperInstalled: false, browsers: state.helper.browsers.map((b) => ({ ...b, installed: false })) };
      return state.helper;
    },

    // System-wide autofill (demo: needs permission until "Enable" is clicked, then ready)
    async autofillStatus() { return state.autofill; },
    async requestAutofillPermission() {
      state.autofill = { ...state.autofill, state: "ready", permission: "granted", helperRunning: true };
      return state.autofill;
    },
    async tryAutofillDemo() {},

    // Agents
    async listAgentActivity(opts) {
      const list = [...state.activity].sort((a, b) => b.at - a.at).filter((a) => (opts?.before ? a.at < opts.before : true));
      return list.slice(0, opts?.limit ?? 50);
    },
    async agentInfo() { return { socketPath: "/Users/alex/Library/Application Support/Flint/agent.sock", tokenPath: "/Users/alex/Library/Application Support/Flint/agent-token", cliInstalled: false, cliPath: null }; },
    async installCli() { return { path: "/usr/local/bin/flint" }; },
    async agentSkillStatus() { return state.skill; },
    async installAgentSkill() {
      state.skill = { installed: true, targets: state.skill.targets.map((t) => ({ ...t, installed: t.present })) };
      return state.skill;
    },
    async removeAgentSkill() {
      state.skill = { installed: false, targets: state.skill.targets.map((t) => ({ ...t, installed: false })) };
      return state.skill;
    },

    // Settings
    async getSettings() { return state.settings; },
    async updateSettings(patch: DeepPartial<Settings>) {
      state.settings = deepMerge(state.settings, patch);
      emit({ type: "settings", settings: state.settings });
      return state.settings;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return api;
}

