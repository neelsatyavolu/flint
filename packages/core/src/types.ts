// Domain types shared by core, the desktop app, the CLI and the agent API.
// Everything here must stay JSON-serializable: it crosses IPC and HTTP.

export type AccountId = string;
export type ThreadId = number;
export type MessageRowId = number;
export type FolderId = number;

export type Address = { name: string; address: string };

export type Provider = "gmail" | "imap";
export type AuthKind = "oauth_google" | "password";

/** What the sign-in form should tell the user about the password: 'proton_bridge' = the Bridge password, 'app_password' = an app password. */
export type ServerHint = "proton_bridge" | "app_password" | null;

export type ServerConfig = {
  imapHost: string; imapPort: number; imapSecure: boolean;
  smtpHost: string; smtpPort: number; smtpSecure: boolean;
  username: string;
};

/** What autoconfig returns: server settings plus an optional note for the sign-in form. Never stored on an account. */
export type AutoconfigResult = ServerConfig & { hint?: ServerHint };

export type Account = ServerConfig & {
  id: AccountId;
  email: string;
  name: string;
  provider: Provider;
  authKind: AuthKind;
  color: string | null;
  sortOrder: number;
  enabled: boolean;
  aliases: string[];
  createdAt: number;
  /** False: this account's mail is left out of every all-accounts view (unified Inbox, Home, counts, badge, bundles). Its own inbox still works. */
  showInUnified: boolean;
  /** Where the account's profile picture came from: the Google sign-in, a photo the user picked, or none (initials). */
  avatarSource: "google" | "custom" | null;
  /** Epoch ms the picture last changed; null with no picture. Lets the UI drop cached copies. */
  avatarUpdatedAt: number | null;
};

/** What getAvatars is asked for: one of the user's accounts, or a sender's address. */
export type AvatarRef = { kind: "account"; accountId: AccountId } | { kind: "sender"; address: string };
/** Key of an AvatarRef in the getAvatars result: "account:<id>" or "sender:<lowercased address>". */
export const avatarKey = (ref: AvatarRef): string =>
  ref.kind === "account" ? `account:${ref.accountId}` : `sender:${ref.address.trim().toLowerCase()}`;

/** Password / app password accounts. Gmail app passwords use provider 'gmail'. */
export type AddAccountInput = {
  email: string;
  name: string;
  password: string;
  provider?: Provider;
  server?: ServerConfig; // omitted = autoconfig
};

export type MailboxRole = "inbox" | "sent" | "drafts" | "trash" | "spam" | "archive" | "all" | "flagged" | "important";

export type Folder = {
  id: FolderId;
  accountId: AccountId;
  path: string;
  name: string;
  role: MailboxRole | null;
  unread: number;
  total: number;
};

export type Category = "people" | "notifications" | "newsletters";

export type SyncState = "idle" | "syncing" | "error" | "offline" | "auth_error";
export type SyncStatus = {
  accountId: AccountId;
  state: SyncState;
  error?: string;
  lastSyncAt?: number;
  progress?: { done: number; total: number; folder?: string };
};

// ---------- Lists ----------

export type View =
  | "home" | "inbox" | "pinned" | "drafts" | "sent" | "trash" | "spam" | "archive"
  | "snoozed" | "scheduled" | "folder" | "blocked" | "search" | "receipts" | "agent_activity";

export type ThreadQuery = {
  view: Exclude<View, "home" | "receipts" | "agent_activity" | "scheduled">;
  accountId?: AccountId;   // undefined = unified across accounts
  folderId?: FolderId;     // view 'folder'
  search?: string;         // view 'search'; supports from: to: subject: has:attachment is:unread is:pinned before: after: in:
  focused?: boolean;       // inbox only: people threads listed, others folded into bundles
  category?: Category;     // inbox only: open one bundle
  unreadOnly?: boolean;
  sort?: "newest" | "oldest";
  cursor?: string;         // opaque, from ThreadPage.nextCursor
  limit?: number;          // default 50, max 200
};

export type ThreadListItem = {
  id: ThreadId;
  accountId: AccountId;
  subject: string;
  snippet: string;
  participants: Address[];  // senders in display order, most recent last, the user shown as "me"
  lastDate: number;         // resurfaced_at when later
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  pinned: boolean;
  muted: boolean;
  snoozedUntil: number | null;
  category: Category;
  hasDraft: boolean;
  receipt: ReceiptSummary | null; // only for threads whose latest sent mail is tracked
  /**
   * Drafts view only. `draftId` set: a local draft (an item for a draft without a thread has a negative `id`; do not
   * pass that id to thread actions). `messageId` set: a server Drafts copy with no local draft, opened with openServerDraft.
   */
  draft?: { draftId: number | null; messageId: MessageRowId | null };
};

export type Bundle = {
  category: Exclude<Category, "people">;
  unreadCount: number;
  totalCount: number;
  lastDate: number;
  latest: { from: Address; subject: string }[]; // up to 3
};

export type ThreadPage = {
  items: ThreadListItem[];
  bundles: Bundle[];       // only when query.focused
  nextCursor: string | null;
  /** On the last page only: the server holds older mail for this list that is not on this computer yet. */
  olderOnServer?: boolean;
};

/** Result of FlintApi.loadOlder: how many messages arrived and whether the server still has older ones. */
export type LoadOlderResult = { loaded: number; hasMore: boolean };

/** Result of FlintApi.searchServer: messages the server matched and how many of them were new here. */
export type ServerSearchResult = { found: number; added: number };

// ---------- Reading ----------

export type AttachmentInfo = {
  id: number;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
  contentId: string | null;
};

export type MessageView = {
  id: MessageRowId;
  accountId: AccountId;
  threadId: ThreadId;
  messageId: string | null;
  from: Address[];
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  subject: string;
  date: number;
  seen: boolean;
  pinned: boolean;
  isFromMe: boolean;
  snippet: string;
  /** Sanitized HTML safe to place in a sandboxed iframe (scripts, forms, event handlers removed). */
  html: string | null;
  text: string | null;
  bodyLoaded: boolean;
  remoteImages: "allowed" | "blocked";
  hasTrackers: boolean; // known third-party tracking pixels were removed
  attachments: AttachmentInfo[];
  unsubscribe: { url?: string; mailto?: string; oneClick: boolean } | null;
  receipt: ReceiptDetail | null; // when this is a tracked mail the user sent
};

export type ThreadDetail = {
  id: ThreadId;
  accountId: AccountId;
  subject: string;
  category: Category;
  pinned: boolean;
  muted: boolean;
  snoozedUntil: number | null;
  messages: MessageView[]; // oldest first
  draftIds: number[];
};

export type SidebarAccount = { account: Account; inboxUnread: number; folders: Folder[]; sync: SyncStatus };
export type SidebarData = {
  accounts: SidebarAccount[];
  counts: { inbox: number; pinned: number; drafts: number; snoozed: number; scheduled: number; awaitingApproval: number; spam: number };
};

// ---------- Compose ----------

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";
export type DraftAttachment = { id: string; filename: string; contentType: string; size: number; path: string; inline?: boolean; contentId?: string };

export type Draft = {
  id: number;
  accountId: AccountId;
  from: string;
  mode: ComposeMode;
  sourceMessageId: MessageRowId | null;
  threadId: ThreadId | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;           // body the user wrote (signature included as a marked block)
  quotedHtml: string;     // quoted original, shown collapsed
  attachments: DraftAttachment[];
  signatureId: number | null;
  track: boolean;
  remindAt: number | null;
  createdBy: string;
  updatedAt: number;
  /**
   * Set by the service when read receipts cannot work for a send right now (plain-text mode, receipts off, no
   * receipts address), e.g. "Receipts off: plain-text mode". The composer shows it instead of a live toggle.
   */
  trackingBlockedReason?: string | null;
};

export type DraftInit =
  | { mode: "new"; accountId?: AccountId; to?: Address[]; subject?: string; html?: string; templateId?: number }
  | { mode: "reply" | "replyAll" | "forward"; messageId: MessageRowId; html?: string };

export type DraftPatch = Partial<Pick<Draft, "from" | "accountId" | "to" | "cc" | "bcc" | "subject" | "html" | "signatureId" | "track" | "remindAt">>;

export type ScheduledSend = {
  id: number;
  draftId: number;
  subject: string;
  to: Address[];
  sendAt: number;
  status: "pending" | "awaiting_approval" | "sending" | "sent" | "failed" | "cancelled";
  error: string | null;
  requestedBy: string;
};

export type SendResult = { scheduledId: number; sendAt: number; undoUntil: number; status: ScheduledSend["status"] };

export type Signature = { id: number; name: string; html: string; /** Accounts that can use it; empty = every account. */ accountIds: AccountId[]; defaultNew: boolean; defaultReply: boolean };
export type Template = { id: number; name: string; subject: string; html: string };

export type RuleField = "from" | "to" | "cc" | "subject" | "body" | "any_recipient" | "list_id" | "has_attachment";
export type RuleCondition = { field: RuleField; op: "contains" | "equals" | "ends_with" | "matches" | "is_true"; value: string };
export type RuleAction =
  | { type: "move"; folderPath: string }
  | { type: "archive" } | { type: "trash" } | { type: "mark_read" } | { type: "pin" }
  | { type: "category"; category: Category } | { type: "mute" } | { type: "notify"; enabled: boolean };
export type Rule = { id: number; name: string; enabled: boolean; accountId: AccountId | null; match: "all" | "any"; conditions: RuleCondition[]; actions: RuleAction[]; sortOrder: number };

export type Contact = { email: string; name: string; score: number };

// ---------- Read receipts ----------

/**
 * sent        — delivered to the server, no signal yet
 * opened      — at least one open that passed every false-positive filter
 * replied     — the recipient replied (strongest signal; implies read)
 * unknowable  — the recipient's mail app prefetches images (Apple Mail Privacy Protection), so opens can't be confirmed
 * untracked   — tracking was off, the service was unreachable, or the recipient is the user
 */
export type ReceiptStatus = "sent" | "opened" | "replied" | "unknowable" | "untracked";

/** Events as classified by the receipts service; only 'open' counts. */
export type ReceiptEventKind = "open" | "prefetch" | "scanner" | "self" | "bot" | "duplicate";

export type ReceiptRecipient = {
  email: string;
  name: string;
  status: ReceiptStatus;
  firstOpenAt: number | null;
  lastOpenAt: number | null;
  openCount: number;
  repliedAt: number | null;
  note: string | null;
  possiblyForwarded: boolean;
};

export type ReceiptSummary = { opened: number; total: number; status: ReceiptStatus; lastOpenAt: number | null };
export type ReceiptDetail = {
  trackedId: number;
  sentAt: number;
  recipients: ReceiptRecipient[];
  events: { at: number; email: string; kind: ReceiptEventKind; client: string | null; device: string | null; location: string | null; counted: boolean }[];
};
export type TrackedMessage = { trackedId: number; accountId: AccountId; threadId: ThreadId | null; subject: string; sentAt: number; summary: ReceiptSummary; recipients: ReceiptRecipient[] };

// ---------- AI ----------

export type AiProvider = "codex" | "grok";
export type AiStatus = {
  provider: AiProvider | null;
  connected: boolean;
  model: string | null;
  models: { id: string; label: string }[];
  enabled: boolean;
};

export type RewriteStyle = "shorter" | "longer" | "formal" | "friendly" | "fix" | "simplify";

export type AiTask =
  | { kind: "summarize"; threadId: ThreadId }
  | { kind: "reply"; threadId: ThreadId; instructions?: string }
  | { kind: "quickReplies"; threadId: ThreadId }
  | { kind: "compose"; prompt: string; draftId?: number }
  | { kind: "rewrite"; text: string; style: RewriteStyle | string }
  | { kind: "translate"; text?: string; threadId?: ThreadId; language: string }
  | { kind: "ask"; question: string; history?: { role: "user" | "assistant"; content: string }[] }
  /** Streamed digest of unread people mail; citations are index-aligned with the [n] markers. */
  | { kind: "digest" }
  /** One-click summary of a Notifications or Newsletters bundle; citations are index-aligned. */
  | { kind: "summarizeBundle"; category: "notifications" | "newsletters" }
  /** People threads waiting on the user's answer. Local heuristic, no model call; the text is JSON. */
  | { kind: "needsReply" };

/** Streamed over events as AiChunk with the same runId. */
export type AiRun = { runId: string };
export type AiChunk =
  | { runId: string; type: "text"; text: string }
  | { runId: string; type: "status"; text: string }
  | { runId: string; type: "citations"; threads: { threadId: ThreadId; subject: string }[] }
  | { runId: string; type: "done"; text: string }
  | { runId: string; type: "error"; message: string };

// ---------- Agents ----------

export type AgentActivity = {
  id: number;
  at: number;
  agent: string;
  method: string;
  summary: string;
  status: "ok" | "error" | "awaiting_approval" | "approved" | "denied";
  detail: Record<string, unknown>;
};

/** One coding agent's user-level skills folder and whether Flint's "flint" skill is in it. */
export type AgentSkillTarget = {
  id: string;
  label: string;          // "Claude Code", "Codex, Gemini CLI, Copilot CLI and OpenCode", ...
  path: string;           // the skill folder, e.g. ~/.claude/skills/flint
  present: boolean;       // the agent seems to be installed on this Mac
  installed: boolean;     // Flint's skill is there
  note?: string;          // why it was skipped
};
export type AgentSkillStatus = { targets: AgentSkillTarget[]; installed: boolean };

// ---------- Home ----------

export type HomeData = {
  greetingName: string;
  unreadPeople: ThreadListItem[];   // up to 5
  pinned: ThreadListItem[];         // up to 5
  awaitingReply: ThreadListItem[];  // reminders due soon / sent mail with no reply, up to 5
  recentReceipts: TrackedMessage[]; // up to 5
  snoozedToday: number;
  scheduledCount: number;
};

// ---------- Settings ----------

export type Settings = {
  appearance: {
    layout: "split" | "full";
    theme: "system" | "dark" | "light";
    avatars: "everywhere" | "list" | "off";
    senderLogos: boolean;         // fetch domain icons for non-person senders
    senderPhotos: boolean;        // look up sender photos on Gravatar (off by default; the address is hashed, which Gravatar can still match)
    /** HTML mail in dark mode: 'match' adapts colors to the theme, 'light' always shows the original white sheet. */
    emailAppearance: "match" | "light";
    previewLines: 0 | 1 | 2;
    density: "comfortable" | "compact";
    accountColors: boolean;
  };
  inbox: {
    focused: boolean;             // smart inbox on by default
    sort: "newest" | "oldest";
    markReadOnOpen: "instant" | "delay" | "never";
    afterArchive: "next" | "previous" | "list";
    blockTrackers: boolean;       // strip known tracking pixels from incoming mail
    remoteImages: "always" | "known_senders" | "never";
  };
  compose: {
    undoSendSeconds: 0 | 5 | 10 | 20 | 30;
    /** Signature new mail and forwards start with, per account. A number picks it, null means none, a missing key means "use the signature flagged as default". */
    defaultSignatureByAccount: Record<AccountId, number | null>;
    /** Same, for replies. */
    defaultReplySignatureByAccount: Record<AccountId, number | null>;
    plainTextOnly: boolean;
  };
  receipts: {
    enabled: boolean;
    defaultOn: boolean;
    endpoint: string;             // receipts service base URL; '' = not configured
    notifyOnOpen: boolean;
  };
  notifications: {
    enabled: boolean;
    scope: "people" | "all" | "none"; // which new mail alerts: everything, the focused "people" category, or nothing
    sound: boolean;
    soundName: (typeof NOTIFICATION_SOUNDS)[number]; // a macOS system sound from NOTIFICATION_SOUNDS ("default" = the system alert sound)
    preview: "sender_subject" | "sender_subject_line" | "none"; // what the alert shows
    badge: "unified_unread" | "people_unread" | "off"; // what the dock badge counts
    disabledAccounts: AccountId[]; // accounts that never alert
  };
  ai: {
    enabled: boolean;
    provider: AiProvider | null;
    model: string | null;
    autoSummarize: boolean;       // summary card on long threads
    smartReplies: boolean;
    autoCategorize: boolean;      // AI second opinion when heuristics are unsure
    writingStyle: string;         // personalization: free text "how I write"
    replyLanguage: string;        // '' = match the thread
  };
  agents: {
    enabled: boolean;             // CLI / agent API on
    modify: "allow" | "deny";     // archive, move, flags, drafts
    send: "allow" | "ask" | "deny"; // 'ask' queues for approval in Agent Activity
  };
  sync: { initialDays: number; bodiesForRecentDays: number };
  // user-supplied OAuth client (Desktop app type). builtIn is reported by getSettings, never stored: true when
  // this build ships its own client, which is used whenever the user hasn't set one.
  google: { clientId: string; clientSecret: string; builtIn?: boolean };
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K] };

// ---------- Events (main → renderer, agent API → CLI) ----------

export type FlintEvent =
  | { type: "sync"; status: SyncStatus }
  | { type: "mail_changed"; accountId: AccountId; threadIds: ThreadId[] } // list/sidebar should refetch
  | { type: "new_mail"; accountId: AccountId; threadId: ThreadId; from: Address; subject: string; category: Category; snippet?: string; forced?: boolean } // snippet: first line of the body when known; forced: a rule asked for an alert
  | { type: "receipt"; trackedId: number; email: string; status: ReceiptStatus; at: number }
  | { type: "send"; scheduled: ScheduledSend }
  | { type: "ai"; chunk: AiChunk }
  | { type: "agent_activity"; activity: AgentActivity }
  | { type: "settings"; settings: Settings }
  | { type: "toast"; level: "info" | "error"; message: string; undoToken?: string };

/** macOS system sounds offered for alerts. "default" lets the system pick. */
export const NOTIFICATION_SOUNDS = ["default", "Basso", "Blow", "Bottle", "Frog", "Funk", "Glass", "Hero", "Morse", "Ping", "Pop", "Purr", "Sosumi", "Submarine", "Tink"] as const;

export class FlintError extends Error {
  constructor(public code: "not_found" | "invalid" | "auth" | "network" | "permission" | "conflict" | "ai_not_connected" | "internal", message: string) {
    super(message);
    this.name = "FlintError";
  }
}
