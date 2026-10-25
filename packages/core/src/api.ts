import type {
  AutoconfigResult,
  Account, AccountId, AddAccountInput, AgentActivity, AgentSkillStatus, AiProvider, AiRun, AiStatus, AiTask, Contact,
  DeepPartial, Draft, DraftInit, DraftPatch, FlintEvent, Folder, FolderId, HomeData, MessageRowId,
  MessageView, ReceiptDetail, Rule, ScheduledSend, SendResult, ServerConfig, Settings, SidebarData, AvatarRef,
  Signature, SyncStatus, Template, ThreadDetail, ThreadId, ThreadPage, ThreadQuery, LoadOlderResult, ServerSearchResult, TrackedMessage,
} from "./types";

/** A signature found in Spark Desktop's settings, with the Flint accounts it is the default for. */
export type SparkSignatureOffer = {
  sparkId: string; name: string; html: string; accounts: string[]; modifiedAt: number;
  matches: { accountId: AccountId; email: string }[];
};
export type SparkSignatureScan = { path: string; signatures: SparkSignatureOffer[] };
export type ImportSparkSignaturesInput = { path?: string; items: { sparkId: string; name?: string; setDefaultFor: AccountId[] }[] };

/**
 * The one surface every client uses. The desktop renderer reaches it over IPC
 * (window.flint), local agents over the agent API (flint CLI). The service in
 * core/src/service implements it; tests and the web preview use a mock.
 *
 * Every method takes plain JSON and returns plain JSON. Errors are thrown as
 * FlintError (code + message) and re-thrown on the other side of IPC/HTTP.
 */
export interface FlintApi {
  // Accounts
  listAccounts(): Promise<Account[]>;
  autoconfig(email: string): Promise<AutoconfigResult | null>;
  testConnection(input: AddAccountInput): Promise<{ imap: "ok" | string; smtp: "ok" | string }>;
  addAccount(input: AddAccountInput): Promise<Account>;
  /** Opens the system browser for Google sign-in and resolves once the loopback callback lands. */
  addGoogleAccount(): Promise<Account>;
  updateAccount(id: AccountId, patch: Partial<Pick<Account, "name" | "color" | "sortOrder" | "enabled" | "aliases" | "showInUnified">>): Promise<Account>;
  removeAccount(id: AccountId): Promise<void>;
  /** Sets (a square PNG or JPEG data URL, already cropped and resized by the UI) or removes (null) the account's own profile picture. */
  setAccountAvatar(id: AccountId, image: string | null): Promise<Account>;
  /**
   * Profile pictures as data URLs, keyed by avatarKey(ref); null = none, show initials. Account refs resolve from the
   * stored picture. Sender refs resolve from the on-disk cache and Gravatar / sender logos (fetched by core, never by
   * the renderer), honoring settings.appearance.senderPhotos and senderLogos. Mail from the user's own addresses resolves
   * to that account's picture.
   */
  getAvatars(refs: AvatarRef[]): Promise<Record<string, string | null>>;

  // Sync
  syncNow(accountId?: AccountId): Promise<void>;
  getSyncStatus(): Promise<SyncStatus[]>;

  // Navigation and reading
  getSidebar(): Promise<SidebarData>;
  getHome(): Promise<HomeData>;
  listThreads(query: ThreadQuery): Promise<ThreadPage>;
  /** Fetches the next batch of mail older than what is synced for the folders behind this list. */
  loadOlder(query: ThreadQuery): Promise<LoadOlderResult>;
  /** Searches the mail server for this query and stores matches that are not local yet. Local search then finds them. */
  searchServer(search: string, accountId?: AccountId): Promise<ServerSearchResult>;
  getThread(id: ThreadId): Promise<ThreadDetail>;
  getMessage(id: MessageRowId): Promise<MessageView>;
  /** Loads remote images for this message (and remembers the sender when `always`). */
  allowRemoteImages(id: MessageRowId, always: boolean): Promise<MessageView>;
  listFolders(accountId: AccountId): Promise<Folder[]>;
  /** Saves the attachment to the downloads folder (or `path`) and returns the file path. */
  saveAttachment(attachmentId: number, path?: string): Promise<string>;
  openAttachment(attachmentId: number): Promise<void>;
  suggestContacts(prefix: string, limit?: number): Promise<Contact[]>;

  // Thread actions. Each returns an undo token the UI can pass to undo().
  markRead(threadIds: ThreadId[], read: boolean): Promise<{ undoToken: string }>;
  setPinned(threadIds: ThreadId[], pinned: boolean): Promise<{ undoToken: string }>;
  archive(threadIds: ThreadId[]): Promise<{ undoToken: string }>;
  trash(threadIds: ThreadId[]): Promise<{ undoToken: string }>;
  markSpam(threadIds: ThreadId[], spam: boolean): Promise<{ undoToken: string }>;
  moveToFolder(threadIds: ThreadId[], folderId: FolderId): Promise<{ undoToken: string }>;
  moveToInbox(threadIds: ThreadId[]): Promise<{ undoToken: string }>;
  snooze(threadIds: ThreadId[], until: number): Promise<{ undoToken: string }>;
  unsnooze(threadIds: ThreadId[]): Promise<{ undoToken: string }>;
  setMuted(threadIds: ThreadId[], muted: boolean): Promise<{ undoToken: string }>;
  undo(undoToken: string): Promise<void>;
  unsubscribe(messageId: MessageRowId): Promise<{ method: "one_click" | "mailto" | "browser" }>;

  // Blocked senders (Gatekeeper-style: their mail goes to the Blocked view, never the inbox)
  blockSender(pattern: string): Promise<void>;
  unblockSender(pattern: string): Promise<void>;
  listBlocked(): Promise<{ pattern: string; createdAt: number }[]>;

  // Compose
  createDraft(init: DraftInit): Promise<Draft>;
  getDraft(id: number): Promise<Draft>;
  updateDraft(id: number, patch: DraftPatch): Promise<Draft>;
  deleteDraft(id: number): Promise<void>;
  listDrafts(): Promise<Draft[]>;
  /**
   * Opens a server Drafts copy that has no local draft (started in Gmail web or another app): creates a local draft from it,
   * linked to the server copy so the next save replaces that copy. Returns the existing draft when one is already linked.
   */
  openServerDraft(messageId: MessageRowId): Promise<Draft>;
  addAttachment(draftId: number, filePath: string): Promise<Draft>;
  removeAttachment(draftId: number, attachmentId: string): Promise<Draft>;
  /** Queues the draft. Sends after the undo delay, or at `sendAt` for send-later. */
  sendDraft(id: number, opts?: { sendAt?: number }): Promise<SendResult>;
  cancelSend(scheduledId: number): Promise<Draft>;
  listScheduled(): Promise<ScheduledSend[]>;
  approveSend(scheduledId: number, approve: boolean): Promise<ScheduledSend>;

  // Signatures, templates, rules
  listSignatures(): Promise<Signature[]>;
  saveSignature(sig: Omit<Signature, "id"> & { id?: number }): Promise<Signature>;
  deleteSignature(id: number): Promise<void>;
  /** Signatures in Spark Desktop's settings (or the settings.sqlite at `path`). Null when Spark isn't installed. */
  findSparkSignatures(path?: string): Promise<SparkSignatureScan | null>;
  /** Saves the chosen Spark signatures as Flint signatures (updating ones imported before) and makes them the default for the named accounts. */
  importSparkSignatures(input: ImportSparkSignaturesInput): Promise<Signature[]>;
  listTemplates(): Promise<Template[]>;
  saveTemplate(t: Omit<Template, "id"> & { id?: number }): Promise<Template>;
  deleteTemplate(id: number): Promise<void>;
  listRules(): Promise<Rule[]>;
  saveRule(rule: Omit<Rule, "id"> & { id?: number }): Promise<Rule>;
  deleteRule(id: number): Promise<void>;
  /** Runs enabled rules over existing inbox mail; returns how many threads changed. */
  applyRules(ruleId?: number): Promise<{ changed: number }>;

  // Read receipts
  listTracked(opts?: { limit?: number; status?: "opened" | "unopened" }): Promise<TrackedMessage[]>;
  getReceipt(trackedId: number): Promise<ReceiptDetail>;
  refreshReceipts(): Promise<void>;
  stopTracking(trackedId: number): Promise<void>;

  // AI (the user's own ChatGPT or Grok subscription via shared-ai-auth)
  aiStatus(): Promise<AiStatus>;
  /** Returns the URL to open. Codex completes on the localhost callback; Grok needs aiFinishConnect with the pasted code. */
  aiStartConnect(provider: AiProvider): Promise<{ url: string; needsPaste: boolean }>;
  aiFinishConnect(provider: AiProvider, pasted: string): Promise<AiStatus>;
  aiDisconnect(): Promise<AiStatus>;
  aiSetModel(model: string): Promise<AiStatus>;
  /** Starts a task; output streams as `ai` events with this runId. */
  aiRun(task: AiTask): Promise<AiRun>;
  /** Same task, awaited to completion (used by the CLI). */
  aiRunToText(task: AiTask): Promise<{ text: string }>;
  aiCancel(runId: string): Promise<void>;

  // Agents
  listAgentActivity(opts?: { limit?: number; before?: number }): Promise<AgentActivity[]>;
  agentInfo(): Promise<{ socketPath: string; tokenPath: string; cliInstalled: boolean; cliPath: string | null }>;
  installCli(): Promise<{ path: string }>;
  /** Where the "flint" Agent Skill is (or could be) installed for each coding agent on this Mac. */
  agentSkillStatus(): Promise<AgentSkillStatus>;
  /** Writes the skill for every agent found, installing the flint command first if needed. */
  installAgentSkill(): Promise<AgentSkillStatus>;
  /** Removes the copies of the skill Flint wrote. */
  removeAgentSkill(): Promise<AgentSkillStatus>;

  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(patch: DeepPartial<Settings>): Promise<Settings>;

  /** Shows a notification with the current notification settings so the user can try them. */
  sendTestNotification(): Promise<void>;

  // Events. Over IPC this is a subscription; over the agent API it is an SSE stream.
  subscribe(listener: (event: FlintEvent) => void): () => void;
}

export type FlintMethod = Exclude<keyof FlintApi, "subscribe">;

/**
 * Permission tier per method, used by the agent API (and checked by the CLI for
 * nicer errors). 'read' is always allowed while agents are enabled; 'modify'
 * follows settings.agents.modify; 'send' follows settings.agents.send;
 * 'admin' is never available to agents.
 */
export const METHOD_TIERS: Record<FlintMethod, "read" | "modify" | "send" | "admin"> = {
  listAccounts: "read", autoconfig: "read", testConnection: "admin", addAccount: "admin", addGoogleAccount: "admin",
  updateAccount: "admin", removeAccount: "admin", setAccountAvatar: "admin", getAvatars: "admin",
  syncNow: "read", getSyncStatus: "read",
  getSidebar: "read", getHome: "read", listThreads: "read", loadOlder: "read", searchServer: "read", getThread: "read", getMessage: "read",
  allowRemoteImages: "modify", listFolders: "read", saveAttachment: "read", openAttachment: "admin", suggestContacts: "read",
  markRead: "modify", setPinned: "modify", archive: "modify", trash: "modify", markSpam: "modify",
  moveToFolder: "modify", moveToInbox: "modify", snooze: "modify", unsnooze: "modify", setMuted: "modify", undo: "modify",
  unsubscribe: "send",
  blockSender: "modify", unblockSender: "modify", listBlocked: "read",
  createDraft: "modify", getDraft: "read", updateDraft: "modify", deleteDraft: "modify", listDrafts: "read", openServerDraft: "modify",
  addAttachment: "modify", removeAttachment: "modify",
  sendDraft: "send", cancelSend: "modify", listScheduled: "read", approveSend: "admin",
  listSignatures: "read", saveSignature: "admin", deleteSignature: "admin",
  findSparkSignatures: "admin", importSparkSignatures: "admin",
  listTemplates: "read", saveTemplate: "admin", deleteTemplate: "admin",
  listRules: "read", saveRule: "admin", deleteRule: "admin", applyRules: "modify",
  listTracked: "read", getReceipt: "read", refreshReceipts: "read", stopTracking: "modify",
  aiStatus: "read", aiStartConnect: "admin", aiFinishConnect: "admin", aiDisconnect: "admin", aiSetModel: "admin",
  aiRun: "read", aiRunToText: "read", aiCancel: "read",
  listAgentActivity: "read", agentInfo: "admin", installCli: "admin",
  agentSkillStatus: "admin", installAgentSkill: "admin", removeAgentSkill: "admin",
  getSettings: "admin", updateSettings: "admin", sendTestNotification: "admin",
};

export const FLINT_METHODS = Object.keys(METHOD_TIERS) as FlintMethod[];
