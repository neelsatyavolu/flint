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
  /**
   * Google accounts only: the sign-in was granted the Calendar events scope, so RSVPs go through the Google Calendar API
   * and the invite card can show conflicts. False for every other account and for Google accounts that signed in before
   * the scope was added (they can grant it with FlintApi.connectGoogleCalendar).
   */
  calendarScope: boolean;
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
  hasAttachments?: boolean; // only threads with a message carrying an attachment
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
  /** A verification code that arrived in this thread and is still valid (not expired). Absent otherwise. */
  verificationCode?: CodeBadge;
  /** The calendar invitation in this thread that matters most for the row chip ("Invite · Tue 3 PM"). Absent when the thread has none. */
  invite?: InviteChip;
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
  /** The verification code found in this message, only while it is still valid (not expired). Absent otherwise. */
  verificationCode?: CodeBadge;
  /**
   * The calendar invitation in this message (a text/calendar part or .ics attachment), parsed and merged with the user's
   * recorded response. Absent when the message has none, or when it has not been checked yet and the body is not loaded.
   * getThread / getMessage fill it from the stored parse and parse lazily for older mail.
   */
  invite?: Invite;
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
  /** Replies already sent from this thread that have not gone out yet (undo window, send later, approval). */
  outgoing?: OutgoingSend[];
};

/** A queued send of a draft in a thread: the reader shows it at the end of the conversation until it goes out. */
export type OutgoingSend = { scheduledId: number; draftId: number; sendAt: number; status: "pending" | "awaiting_approval" | "sending" };

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

// ---------- Verification codes ----------

/**
 * A one-time code found in newly arrived mail. Held in memory only, for CODE_TTL_MS after it was detected
 * (10 minutes), never written to the database. Codes are credentials: only the UI and the codes socket see them,
 * never agents (every FlintApi method that returns one is tier "admin").
 */
export type VerificationCode = {
  id: string;             // random, unguessable
  /** The value to type. Digit codes have spaces and dashes removed ("177 284" is "177284"); alphanumeric codes keep their dash ("X67-UJK"). */
  code: string;
  service: string;        // "KAYAK": from the subject, else the From display name, else the sender's registrable domain
  senderAddress: string;
  senderDomain: string;   // full domain of the sender address, lower case ("mail.kayak.com")
  threadId: ThreadId;
  messageId: MessageRowId;
  accountId: AccountId;
  receivedAt: number;     // ms epoch, the message date
  expiresAt: number;      // ms epoch, detection time + CODE_TTL_MS
  used: boolean;          // the user filled or copied it
};

/** What the thread row and message banner need. */
export type CodeBadge = Pick<VerificationCode, "id" | "code" | "service" | "expiresAt" | "used">;

/**
 * State of system-wide autofill (the FlintAutofill helper, macOS Accessibility). Reported by the desktop app's main
 * process; builds without it (web preview, tests) report supported:false.
 *   off              settings.codes.autofill (or codes.enabled) is off
 *   unavailable      not macOS, or this build ships no helper, or the helper keeps crashing
 *   needs_permission the helper runs but Accessibility is not granted to Flint
 *   ready            permission granted and the helper is running
 */
export type AutofillState = "off" | "unavailable" | "needs_permission" | "ready";
export type AutofillStatus = {
  state: AutofillState;
  supported: boolean;       // false: no helper in this build or not macOS (Settings hides the block's controls)
  permission: "granted" | "needed" | "unknown";
  helperRunning: boolean;
  /** Unused, unexpired codes the helper is currently watching for a field. */
  waiting: number;
  /** The accelerator that is actually registered right now, or null (off, invalid, or taken by another app). */
  shortcutActive: string | null;
};

export type BrowserId = "chrome" | "chrome-beta" | "chrome-canary" | "chromium" | "brave" | "edge" | "vivaldi" | "arc" | "dia" | "firefox";

export type BrowserHelperBrowser = {
  id: BrowserId;
  name: string;
  family: "chromium" | "firefox";
  /** The browser's data folder exists under the (injectable) home folder, so it looks installed. */
  detected: boolean;
  /** Flint's host manifest is in this browser's NativeMessagingHosts folder. */
  installed: boolean;
  /** A manifest with our host name exists there that is not Flint's. Flint never overwrites it. */
  foreign: boolean;
  manifestPath: string;
};

export type BrowserHelperStatus = {
  hostName: string;
  extensionId: string;           // Chromium extension ID (from the manifest key)
  firefoxId: string;
  wrapperPath: string;           // script in Flint's data folder that runs the bundled CLI as the native host
  wrapperInstalled: boolean;
  /** This build can write the helper: the bundled CLI script exists. */
  cliAvailable: boolean;
  /** Folder holding the built extension for "Load unpacked", or null when this build does not ship it. */
  extensionDir: string | null;
  browsers: BrowserHelperBrowser[];
};

// ---------- Calendar invitations ----------

/** iTIP METHOD values Flint recognizes. REQUEST is a new or updated invite; REPLY is a guest answering one. */
export type InviteMethod = "REQUEST" | "CANCEL" | "REPLY" | "PUBLISH" | "COUNTER" | "DECLINECOUNTER" | "REFRESH" | "ADD";

/** A guest's answer (iCalendar PARTSTAT folded to four values: DELEGATED and the rest count as needs-action). */
export type InviteResponse = "accepted" | "tentative" | "declined" | "needs-action";
/** What the user can send back: needs-action is a state, never an answer. */
export type RsvpResponse = Exclude<InviteResponse, "needs-action">;

/**
 * What the card shows, worked out by the service at read time (never stored):
 *  new        a REQUEST (or PUBLISH) with the highest SEQUENCE Flint has seen for this event
 *  updated    a REQUEST whose SEQUENCE is higher than an earlier invite for the same event Flint has seen; `changes` says what
 *  cancelled  METHOD:CANCEL, or a later CANCEL for the same UID has arrived; no RSVP
 *  past       the event has ended (and is not cancelled); RSVP is off
 *  superseded a newer invite for the same event is in another message; the card links to it instead of taking an RSVP
 *  reply      METHOD:REPLY, a guest answering an invite the user sent: shown as "Carla accepted"
 *  counter    COUNTER / DECLINECOUNTER / REFRESH / ADD: shown plainly, no actions
 */
export type InviteState = "new" | "updated" | "cancelled" | "past" | "superseded" | "reply" | "counter";

export type InviteAttendee = {
  name: string;
  address: string;                 // lower case
  response: InviteResponse;
  role: "chair" | "required" | "optional" | "non-participant";
  /** The invite asks this guest to respond (RSVP=TRUE). */
  rsvp: boolean;
  /** One of the user's own addresses (account email or alias). */
  isYou: boolean;
};

export type ConferenceKind = "meet" | "zoom" | "teams" | "webex" | "other";
export type InviteConference = {
  kind: ConferenceKind;
  /** The join link (https). */
  url: string;
  /** "Google Meet", "Zoom", "Microsoft Teams", "Webex", or the host name for "other". */
  label: string;
  /** Meeting ID / access code when the invite lists one. */
  code: string | null;
  /** Dial-in number (E.164-ish text as sent) when the invite lists one. */
  phone: string | null;
};

/** One thing that differs from the earlier invite of the same event (shown on the Updated card). Values are display text in the viewer's locale and zone. */
export type InviteChange = { field: "time" | "location" | "title" | "guests" | "description" | "recurrence" | "conference"; before: string | null; after: string | null };

/**
 * A parsed calendar invitation. JSON-only, so it crosses IPC and HTTP. `ParsedInvite` is the part that is stored per message
 * (everything above the "merged at read time" line); the service adds the rest when it builds a MessageView.
 */
export type Invite = {
  // ---- stored per message (the parser's output) ----
  uid: string;
  method: InviteMethod;
  sequence: number;
  /** RECURRENCE-ID as the calendar sent it ("20261027T150000Z", "20261027"), or null for the whole event / series. Needed to answer a single occurrence. */
  recurrenceId: string | null;
  title: string;
  /** Plain text, boilerplate such as "Invitation from Google Calendar" and join-link blocks removed. Null when empty. */
  description: string | null;
  /**
   * Timed events: epoch ms. All-day events: epoch ms of 00:00 UTC on `startDate` / `endDate` (use the date strings, not the
   * instant, to display them; they never shift with the viewer's zone).
   */
  start: number;
  end: number;
  allDay: boolean;
  /** All-day only: "2026-10-27" first day, and the day AFTER the last day (iCalendar's exclusive DTEND). */
  startDate: string | null;
  endDate: string | null;
  /** IANA zone the organizer set on DTSTART ("America/Los_Angeles"; Windows names like "Pacific Standard Time" are mapped). "UTC" for Z times, null when floating or all-day. */
  timeZone: string | null;
  recurrence: InviteRecurrence | null;
  location: string | null;
  /** The event's URL property, when it differs from the conference link. */
  url: string | null;
  conference: InviteConference | null;
  organizer: Address | null;
  attendees: InviteAttendee[];
  /** The PARTSTAT the invite itself carried for the user (usually needs-action); local responses are layered on top in `yourResponse`. */
  invitedAs: { address: string; role: InviteAttendee["role"]; rsvp: boolean } | null;
  /** DTSTAMP, epoch ms; orders two invites with the same SEQUENCE. */
  dtstamp: number | null;
  /** Who made it, from PRODID. Decides the "Open in Google Calendar" link and nothing else. */
  source: "google" | "outlook" | "apple" | "zoom" | "other";
  /** Google event link ("https://www.google.com/calendar/event?eid=...") when the invite carries one. */
  googleEventUrl: string | null;
  /** REPLY only: who answered and what they said. */
  reply: { from: Address; response: InviteResponse; comment: string | null } | null;

  // ---- merged at read time (the service fills these) ----
  state: InviteState;
  /** The user's answer: the recorded local response when there is one, else the PARTSTAT the invite carried. */
  yourResponse: InviteResponse;
  respondedAt: number | null;
  /** The note sent with the last answer, or null. */
  yourNote: string | null;
  /** What differs from the earlier version, for state "updated". Empty otherwise. */
  changes: InviteChange[];
  /** Row id of the newest message about the same event when this one is superseded, else null. */
  newerMessageId: MessageRowId | null;
  /**
   * How an RSVP will be delivered: the Google Calendar API ("google-calendar": a Gmail account with the calendar scope or a
   * Google calendar account covering the invited address), a CalDAV calendar account ("caldav"), an iMIP reply by mail
   * ("imip": no calendar covers the invited address, so the card can offer to add one), or not at all (cancelled, past, a
   * REPLY, or the user is not a guest). The card shows "Connect Google Calendar" for "google-needs-scope".
   */
  rsvpVia: "google-calendar" | "caldav" | "imip" | "google-needs-scope" | "none";
};

export type InviteRecurrence = {
  /** "Weekly on Tuesday until Dec 12", "Every weekday", "Monthly on the 3rd". Never empty. */
  summary: string;
  /** The RRULE value without the "RRULE:" prefix, for CLI/agents. */
  rrule: string;
  /** EXDATE / RDATE present, or this message is a single-occurrence update inside a series. */
  hasExceptions: boolean;
  /** EXDATE instants (epoch ms; all-day: 00:00 UTC). Absent on invites parsed before parser version 2. */
  excluded?: number[];
  /** RDATE instants, same units. */
  added?: number[];
};

/** The few fields the thread row and the CLI list need. Derived from Invite. */
export type InviteChip = Pick<Invite, "uid" | "method" | "title" | "start" | "end" | "allDay" | "startDate" | "state" | "yourResponse"> & {
  /** Organizer's display name or address. */
  organizerName: string | null;
  /** The message the chip comes from. */
  messageId: MessageRowId;
};

/** One row of listInvites / `flint invites`. */
export type InviteListItem = { threadId: ThreadId; accountId: AccountId; subject: string; invite: InviteChip };

export type InviteConflict = { title: string; start: number; end: number; allDay: boolean };
/**
 * inviteConflicts result. status "unknown" says why in `reason`: "no-scope" (Gmail account without the calendar scope and
 * no calendar account covering the address), "no-calendar" (no calendar account covers the invited address; this replaces
 * "not-google", which is no longer produced), "no-time" (nothing to compare), "error" (Google was unreachable; `message` has the text).
 * "free" means the primary calendar has nothing overlapping that the user has not declined, ignoring this event itself.
 */
export type InviteConflicts =
  | { status: "free"; checkedAt: number }
  | { status: "conflict"; checkedAt: number; events: InviteConflict[] }
  | { status: "unknown"; reason: "no-scope" | "no-calendar" | "not-google" | "no-time" | "error"; message?: string };

// ---------- Calendar accounts (Settings > Calendars) ----------

/** CalDAV servers Flint knows the address of. */
export type CalDavPreset = "icloud" | "fastmail";
export const CALDAV_PRESETS: Record<CalDavPreset, { name: string; url: string }> = {
  icloud: { name: "iCloud Calendar", url: "https://caldav.icloud.com" },
  fastmail: { name: "Fastmail Calendar", url: "https://caldav.fastmail.com/dav/" },
};

/**
 * A calendar Flint answers invitations on, independent of the mail account the invitation arrived on. Besides the rows the
 * user added, every Gmail sign-in with the calendar scope appears here as an implicit entry (id "mail:<accountId>",
 * viaMailAccountId set): it covers its own address and aliases, is managed from its mail account, and cannot be edited or
 * removed here.
 */
export type CalendarAccount = {
  id: string;
  kind: "google" | "caldav";
  name: string;
  /** Which server a caldav account talks to; null for Google. */
  preset: CalDavPreset | "custom" | null;
  /** The account's own address: the Google account email, or the CalDAV username when it is an address (else the first discovered one). */
  email: string;
  /** Every address this calendar answers invitations for, lower case: `email`, the ones the server reported, and `extraAddresses`. */
  addresses: string[];
  /** Addresses the user added by hand (aliases, another mailbox that invites into this calendar). */
  extraAddresses: string[];
  /** CalDAV only. */
  serverUrl: string | null;
  username: string | null;
  /** Name of the calendar new events and answers go to (CalDAV default calendar); null for Google (the primary calendar). */
  calendarName: string | null;
  /** CalDAV: the server sends your answer to the organizer itself (RFC 6638). Null for Google. */
  scheduling: boolean | null;
  /** "needs-signin": the saved sign-in or password stopped working. */
  status: "ok" | "needs-signin" | "error";
  statusMessage: string | null;
  /** Set on the implicit entry for a Gmail account with the calendar scope. */
  viaMailAccountId: AccountId | null;
  createdAt: number;
};

/** True when one of the calendar accounts covers the mail account's address or one of its aliases. */
export function calendarCovers(account: Pick<Account, "email" | "aliases">, calendars: readonly Pick<CalendarAccount, "addresses">[]): boolean {
  const own = [account.email, ...account.aliases].map((a) => a.toLowerCase());
  return calendars.some((c) => c.addresses.some((a) => own.includes(a.toLowerCase())));
}

/** The calendar accounts covering an address (case-insensitive). */
export const calendarsFor = <C extends Pick<CalendarAccount, "addresses">>(address: string, calendars: readonly C[]): C[] =>
  calendars.filter((c) => c.addresses.some((a) => a.toLowerCase() === address.trim().toLowerCase()));

export type AddCalDavAccountInput = {
  /** A known server; or give `url`. */
  preset?: CalDavPreset;
  /** Server address for "other CalDAV" (https only). */
  url?: string;
  /** Account login. For iCloud the Apple ID; for Fastmail the full address. */
  username: string;
  /** App-specific password (iCloud: appleid.apple.com > Sign-In and Security > App-Specific Passwords). Saved in the secret store only. */
  password: string;
  name?: string;
  /** Extra addresses this calendar should answer invitations for. */
  extraAddresses?: string[];
};

export type AddGoogleCalendarInput = {
  /** Pre-selects this Google account in the consent window (the invited address). The account that signs in decides what is saved. */
  loginHint?: string;
  name?: string;
  extraAddresses?: string[];
};

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
  // How the desktop app updates itself from GitHub Releases: "auto" downloads and installs on the next quit without
  // asking, "ask" downloads then offers a restart, "manual" checks only from Flint > Check for Updates.
  updates: { mode: "auto" | "ask" | "manual" };
  /** Verification codes found in new mail. Defaults: enabled true, notify true, autoCopy false, autofill true, shortcut Control+Option+V. */
  codes: {
    enabled: boolean;     // detect codes at all (off: nothing is kept, the socket serves nothing)
    notify: boolean;      // show "KAYAK code 530331" with a Copy code button
    autoCopy: boolean;    // copy each new code to the clipboard; cleared after 90 s only if it still holds that code
    autofill: boolean;    // system-wide autofill through macOS Accessibility (the FlintAutofill helper). Default true; needs the permission to do anything
    shortcut: string;     // Electron accelerator that types the newest code into the focused field, "Control+Option+V" by default; "" turns it off
  };
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
  | { type: "code"; code: VerificationCode } // a new verification code was detected (the UI shows it; never reaches the agent API stream)
  | { type: "toast"; level: "info" | "error"; message: string; undoToken?: string };

/** macOS system sounds offered for alerts. "default" lets the system pick. */
export const NOTIFICATION_SOUNDS = ["default", "Basso", "Blow", "Bottle", "Frog", "Funk", "Glass", "Hero", "Morse", "Ping", "Pop", "Purr", "Sosumi", "Submarine", "Tink"] as const;

export class FlintError extends Error {
  constructor(public code: "not_found" | "invalid" | "auth" | "network" | "permission" | "conflict" | "ai_not_connected" | "internal", message: string) {
    super(message);
    this.name = "FlintError";
  }
}
