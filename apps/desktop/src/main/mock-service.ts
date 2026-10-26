import { agentPaths } from "@flint/core/agent/paths";
import { CODES_EXTENSION_ID, CODES_FIREFOX_ID, CODES_HOST_NAME } from "@flint/core/codes/contract";
import { avatarKey, FlintError } from "@flint/core/types";
import type {
  BrowserHelperStatus, Draft, FlintEvent, HomeData, MessageRowId, Settings, SidebarData, SyncStatus, ThreadPage,
} from "@flint/core/types";
import type { FlintService } from "@flint/core/service/index";
import { MOCK_DEFAULT_SETTINGS, mergeDeep } from "./default-settings";

const notFound = (what: string) => new FlintError("not_found", `${what} not found`);
const undo = { undoToken: "mock" } as const;
const mockHelperStatus: BrowserHelperStatus = {
  hostName: CODES_HOST_NAME, extensionId: CODES_EXTENSION_ID, firefoxId: CODES_FIREFOX_ID, wrapperPath: "", wrapperInstalled: false,
  cliAvailable: false, extensionDir: null, browsers: [],
};
const aiOff = { provider: null, connected: false, model: null, models: [], enabled: true } as const;

/**
 * In-memory FlintService with empty-but-valid data. Used with FLINT_MOCK=1 and
 * as the dev fallback while the real service is not available.
 */
export function createMockService(dataDir: string): FlintService {
  const listeners = new Set<(e: FlintEvent) => void>();
  let settings: Settings = MOCK_DEFAULT_SETTINGS;
  let drafts: readonly Draft[] = [];
  let nextDraftId = 1;
  const emit = (e: FlintEvent): void => listeners.forEach((l) => l(e));

  const emptyPage: ThreadPage = { items: [], bundles: [], nextCursor: null };
  const sidebar: SidebarData = {
    accounts: [],
    counts: { inbox: 0, pinned: 0, drafts: 0, snoozed: 0, scheduled: 0, awaitingApproval: 0, spam: 0 },
  };
  const home: HomeData = {
    greetingName: "", unreadPeople: [], pinned: [], awaitingReply: [], recentReceipts: [], snoozedToday: 0, scheduledCount: 0,
  };
  const syncStatus: SyncStatus[] = [];

  const getDraft = (id: number): Draft => {
    const d = drafts.find((x) => x.id === id);
    if (!d) throw notFound("Draft");
    return d;
  };
  const replaceDraft = (next: Draft): Draft => {
    drafts = drafts.map((d) => (d.id === next.id ? next : d));
    return next;
  };

  return {
    async start() {},
    async stop() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    async listAccounts() { return []; },
    async autoconfig() { return null; },
    async testConnection() { return { imap: "Mock mode: no mail server is contacted", smtp: "Mock mode: no mail server is contacted" }; },
    async addAccount() { throw new FlintError("invalid", "Accounts are unavailable in mock mode"); },
    async addGoogleAccount() { throw new FlintError("invalid", "Accounts are unavailable in mock mode"); },
    async updateAccount() { throw notFound("Account"); },
    async removeAccount() {},
    async setAccountAvatar() { throw notFound("Account"); },
    async getAvatars(refs) { return Object.fromEntries(refs.map((r) => [avatarKey(r), null])); },

    async sendTestNotification() {},

    async syncNow() {},
    async getSyncStatus() { return syncStatus; },

    async getSidebar() { return sidebar; },
    async getHome() { return home; },
    async listThreads() { return emptyPage; },
    async loadOlder() { return { loaded: 0, hasMore: false }; },
    async searchServer() { return { found: 0, added: 0 }; },
    async getThread() { throw notFound("Thread"); },
    async getMessage(_id: MessageRowId) { throw notFound("Message"); },
    async allowRemoteImages() { throw notFound("Message"); },
    async listFolders() { return []; },
    async saveAttachment() { throw notFound("Attachment"); },
    async openAttachment() { throw notFound("Attachment"); },
    async suggestContacts() { return []; },

    async markRead() { return undo; },
    async setPinned() { return undo; },
    async archive() { return undo; },
    async trash() { return undo; },
    async markSpam() { return undo; },
    async moveToFolder() { return undo; },
    async moveToInbox() { return undo; },
    async snooze() { return undo; },
    async unsnooze() { return undo; },
    async setMuted() { return undo; },
    async setCategory() { return undo; },
    async undo() {},
    async unsubscribe() { return { method: "browser" as const }; },

    async blockSender() {},
    async unblockSender() {},
    async listBlocked() { return []; },

    async createDraft(init) {
      const draft: Draft = {
        id: nextDraftId++, accountId: "", from: "", mode: init.mode, sourceMessageId: "messageId" in init ? init.messageId : null,
        threadId: null, to: init.mode === "new" ? (init.to ?? []) : [], cc: [], bcc: [],
        subject: init.mode === "new" ? (init.subject ?? "") : "", html: init.html ?? "", quotedHtml: "",
        attachments: [], signatureId: null, track: false, remindAt: null, createdBy: "mock", updatedAt: Date.now(),
      };
      drafts = [...drafts, draft];
      return draft;
    },
    async getDraft(id) { return getDraft(id); },
    async updateDraft(id, patch) { return replaceDraft({ ...getDraft(id), ...patch, updatedAt: Date.now() }); },
    async deleteDraft(id) { drafts = drafts.filter((d) => d.id !== id); },
    async listDrafts() { return [...drafts]; },
    async openServerDraft() { throw notFound("Draft"); },
    async addAttachment(draftId) { return getDraft(draftId); },
    async removeAttachment(draftId) { return getDraft(draftId); },
    async sendDraft(id) {
      getDraft(id);
      const now = Date.now();
      return { scheduledId: id, sendAt: now, undoUntil: now, status: "cancelled" as const };
    },
    async cancelSend(scheduledId) { return getDraft(scheduledId); },
    async listScheduled() { return []; },
    async approveSend() { throw notFound("Scheduled send"); },

    async listSignatures() { return []; },
    async saveSignature(sig) { return { ...sig, id: sig.id ?? 1 }; },
    async deleteSignature() {},
    async findSparkSignatures() { return null; },
    async importSparkSignatures() { return []; },
    async listTemplates() { return []; },
    async saveTemplate(t) { return { ...t, id: t.id ?? 1 }; },
    async deleteTemplate() {},
    async listRules() { return []; },
    async saveRule(rule) { return { ...rule, id: rule.id ?? 1 }; },
    async deleteRule() {},
    async applyRules() { return { changed: 0 }; },

    async listTracked() { return []; },
    async getReceipt() { throw notFound("Receipt"); },
    async refreshReceipts() {},
    async stopTracking() {},

    async aiStatus() { return { ...aiOff, models: [] }; },
    async aiStartConnect() { throw new FlintError("invalid", "AI is unavailable in mock mode"); },
    async aiFinishConnect() { return { ...aiOff, models: [] }; },
    async aiDisconnect() { return { ...aiOff, models: [] }; },
    async aiSetModel() { return { ...aiOff, models: [] }; },
    async aiRun() { return { runId: "mock" }; },
    async aiRunToText() { return { text: "" }; },
    async aiCancel() {},

    async listAgentActivity() { return []; },
    async agentInfo() {
      return { ...agentPaths(dataDir), cliInstalled: false, cliPath: null };
    },
    async installCli() { throw new FlintError("invalid", "The command line tool is unavailable in mock mode"); },
    async agentSkillStatus() { return { targets: [], installed: false }; },
    async installAgentSkill() { throw new FlintError("invalid", "The agent skill is unavailable in mock mode"); },
    async removeAgentSkill() { return { targets: [], installed: false }; },

    async recentCodes() { return []; },
    async markCodeUsed() {},
    async browserHelperStatus() { return mockHelperStatus; },
    async installBrowserHelper() { throw new FlintError("invalid", "The browser helper is unavailable in mock mode"); },
    async removeBrowserHelper() { return mockHelperStatus; },

    async getSettings() { return settings; },
    async updateSettings(patch) {
      settings = mergeDeep(settings, patch);
      emit({ type: "settings", settings });
      return settings;
    },
  };
}
