import type {
  AutoconfigResult,
  Account, AccountId, AddAccountInput, Category, AgentActivity, AgentSkillStatus, AiProvider, AiRun, AiStatus, AiTask, Contact,
  DeepPartial, Draft, DraftInit, DraftPatch, FlintEvent, Folder, FolderId, HomeData, MessageRowId,
  MessageView, ReceiptDetail, Rule, ScheduledSend, SendResult, ServerConfig, Settings, SidebarData, AvatarRef,
  Invite, InviteConflicts, InviteListItem, RsvpResponse,
  CalendarAccount, AddCalDavAccountInput, AddGoogleCalendarInput,
  Signature, SyncStatus, VerificationCode, BrowserHelperStatus, AutofillStatus, Template, ThreadDetail, ThreadId, ThreadPage, ThreadQuery, LoadOlderResult, ServerSearchResult, TrackedMessage,
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
  /**
   * Files these threads under People, Notifications or Newsletters. The choice is the user's, so automatic categorizing
   * never overrides it. With `sender: true` the senders are remembered (a rule) so their future mail lands there too,
   * and their mail already in the inbox moves as well.
   */
  setCategory(threadIds: ThreadId[], category: Category, opts?: { sender?: boolean }): Promise<{ undoToken: string }>;
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

  // Verification codes. Codes are credentials: all of these are admin tier, so agents can never read them.
  /** Codes detected in the last 10 minutes (not expired), newest first, used ones included. */
  recentCodes(): Promise<VerificationCode[]>;
  /** The user filled or copied this code; the browser extension stops suggesting it. */
  markCodeUsed(id: string): Promise<void>;
  /** Where the browser extension's native messaging host is installed. */
  browserHelperStatus(): Promise<BrowserHelperStatus>;
  /** Writes the host wrapper and a host manifest into every detected browser (never over a manifest that isn't Flint's). */
  installBrowserHelper(): Promise<BrowserHelperStatus>;
  /** Removes the host wrapper and the manifests Flint wrote. */
  removeBrowserHelper(): Promise<BrowserHelperStatus>;

  // System-wide code autofill (macOS Accessibility, the FlintAutofill helper). Admin tier like the code methods.
  /** Current state of autofill. Cheap; the Settings page calls it on open and when the window regains focus. */
  autofillStatus(): Promise<AutofillStatus>;
  /** The user clicked Enable: asks macOS for Accessibility (system prompt) and opens the Accessibility pane. Returns the state right after. */
  requestAutofillPermission(): Promise<AutofillStatus>;
  /** "Try it": opens a small demo window with a code field and shows a suggestion with a fake code next to it. */
  tryAutofillDemo(): Promise<void>;
  // Calendar invitations
  /** The invitation in this message, parsed now if it has not been (older mail). Null when the message has none. */
  getInvite(messageId: MessageRowId): Promise<Invite | null>;
  /**
   * Answers an invitation. Google accounts with the calendar scope patch the event through the Google Calendar API;
   * every other account sends an iMIP REPLY to the organizer. Records the answer locally either way and returns the
   * updated invite. Sends mail or changes the calendar, so agents need the send permission.
   */
  rsvp(messageId: MessageRowId, response: RsvpResponse, note?: string): Promise<Invite>;
  /** Overlap with the user's Google primary calendar for this invite's time (cached briefly). Never throws for a Google problem; check `status`. */
  inviteConflicts(messageId: MessageRowId): Promise<InviteConflicts>;
  /** Runs Google's consent screen for the Calendar scope on an account that signed in without it (include_granted_scopes). Resolves with the updated account. */
  connectGoogleCalendar(accountId: AccountId): Promise<Account>;
  // Calendar accounts: calendars Flint answers invitations on, separate from the mail accounts (Settings > Calendars)
  /** Every calendar account: the ones the user added plus an implicit entry per Gmail sign-in that has the calendar scope. Cheap and local. */
  listCalendarAccounts(): Promise<CalendarAccount[]>;
  /** Opens Google's consent screen for the calendar scope only (no Gmail access). Re-adding an account that exists refreshes its sign-in. */
  addGoogleCalendarAccount(input?: AddGoogleCalendarInput): Promise<CalendarAccount>;
  /** Validates the login by discovery (principal, calendar home, calendars) before saving anything; the password goes to the secret store. */
  addCalDavAccount(input: AddCalDavAccountInput): Promise<CalendarAccount>;
  /** Renames a calendar account or changes the extra addresses it covers. Not for the implicit Gmail entries. */
  updateCalendarAccount(id: string, patch: { name?: string; extraAddresses?: string[] }): Promise<CalendarAccount>;
  /** Forgets a calendar account and its saved sign-in. Not for the implicit Gmail entries. Invitations are answered by email again. */
  removeCalendarAccount(id: string): Promise<void>;
  /** Upcoming invitations (not cancelled, not past) soonest first, newest version per event. `from` / `to` are epoch ms; default from now. */
  listInvites(opts?: { accountId?: AccountId; from?: number; to?: number; limit?: number }): Promise<InviteListItem[]>;

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
  moveToFolder: "modify", moveToInbox: "modify", snooze: "modify", unsnooze: "modify", setMuted: "modify", setCategory: "modify", undo: "modify",
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
  recentCodes: "admin", markCodeUsed: "admin", browserHelperStatus: "admin", installBrowserHelper: "admin", removeBrowserHelper: "admin",
  autofillStatus: "admin", requestAutofillPermission: "admin", tryAutofillDemo: "admin",
  getInvite: "read", rsvp: "send", inviteConflicts: "read", connectGoogleCalendar: "admin", listInvites: "read",
  listCalendarAccounts: "admin", addGoogleCalendarAccount: "admin", addCalDavAccount: "admin", updateCalendarAccount: "admin", removeCalendarAccount: "admin",
  getSettings: "admin", updateSettings: "admin", sendTestNotification: "admin",
};

export const FLINT_METHODS = Object.keys(METHOD_TIERS) as FlintMethod[];
