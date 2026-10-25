import type {
  AccountId, Address, AttachmentInfo, Category, FolderId, MailboxRole, MessageRowId, Provider, RuleAction, ThreadId,
} from "../types";

export type IngestAttachment = {
  part: string;
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
  inline: boolean;
};

export type MessageFlags = { seen: boolean; flagged: boolean; answered: boolean; draft: boolean };

/** One message as the mail engine saw it on the server. Dates are epoch ms. Message-IDs may carry angle brackets. */
export type IngestMessage = {
  uid: number;
  gmMsgid?: string | null;
  gmThrid?: string | null;
  /** Gmail only: the message's labels as folder paths (INBOX, [Gmail]/Sent Mail, user labels). Omit to leave membership alone. */
  gmLabels?: string[];
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  from: Address[];
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  date: number;
  flags: MessageFlags;
  size: number;
  hasAttachments: boolean;
  /** Selected headers, lowercase names: list-unsubscribe, list-unsubscribe-post, list-id, precedence, auto-submitted, x-flint-ref. */
  headers: Record<string, string>;
  snippet?: string;
  textBody?: string | null;
  htmlBody?: string | null;
  attachments?: IngestAttachment[];
};

export type IngestContext = {
  /** Override the clock (tests). */
  now?: number;
  /** false = history backfill: skip blocked-sender and rule evaluation. Default true. */
  evaluate?: boolean;
};

export type ReceiptChange = { trackedId: number; email: string; status: string; at: number };

export type IngestOutcome = {
  uid: number;
  messageRowId: MessageRowId;
  threadId: ThreadId;
  isNew: boolean;
  category: Category;
  fromMe: boolean;
  blocked: boolean;
  /** Every action of every matching rule. `category` and `mute` were already applied locally; the engine performs the rest. */
  ruleActions: RuleAction[];
  /** Threads that were merged into threadId by this message (their ids no longer exist). */
  mergedThreadIds: ThreadId[];
  /** Tracked recipients whose status changed because this message was a reply. */
  receiptChanges: ReceiptChange[];
};

export type MessageBody = {
  text: string | null;
  html: string | null;
  attachments?: IngestAttachment[];
};

export type FlagUpdate = { uid: number; seen?: boolean; flagged?: boolean; answered?: boolean; draft?: boolean };

/** A message row with parsed JSON. Bodies are included; use listings for light queries. */
export type StoredMessage = {
  id: MessageRowId;
  accountId: AccountId;
  threadId: ThreadId;
  folderId: FolderId;
  uid: number;
  gmMsgid: string | null;
  gmThrid: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  from: Address[];
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  date: number;
  snippet: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
  hasAttachments: boolean;
  size: number;
  headers: Record<string, string>;
  bodyLoaded: boolean;
  text: string | null;
  rawHtml: string | null;
  category: Category | null;
};

export type StoredThreadMessage = StoredMessage & {
  isFromMe: boolean;
  /** True when the message sits in a Sent folder (or carries the Sent label), so a "from me" header on it is believable. */
  inSent: boolean;
  attachments: AttachmentInfo[];
  unsubscribe: { url?: string; mailto?: string; oneClick: boolean } | null;
};

export type ThreadRows = {
  id: ThreadId;
  accountId: AccountId;
  subject: string;
  category: Category;
  pinned: boolean;
  muted: boolean;
  snoozedUntil: number | null;
  resurfacedAt: number | null;
  /** Oldest first. */
  messages: StoredThreadMessage[];
  draftIds: number[];
};

/** Where a message lives, for IMAP operations. */
export type MessageLocation = {
  messageRowId: MessageRowId;
  threadId: ThreadId;
  accountId: AccountId;
  provider: Provider;
  folderId: FolderId;
  folderPath: string;
  folderRole: MailboxRole | null;
  uid: number;
  gmMsgid: string | null;
  messageId: string | null;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  /** All folders/labels the message is in now. */
  memberFolderIds: FolderId[];
};

export type ThreadSnapshot = {
  version: 1;
  threads: {
    id: ThreadId;
    pinned: boolean;
    muted: boolean;
    snoozedUntil: number | null;
    resurfacedAt: number | null;
    messages: { id: MessageRowId; folderId: FolderId; uid: number; seen: boolean; flagged: boolean; answered: boolean; memberFolderIds: FolderId[];
      /** Category and who set it, so undoing a category change can put both back (absent in snapshots that predate it). */
      category?: string | null; categorySource?: string | null }[];
  }[];
};

export type ActionResult = { snapshot: ThreadSnapshot; locations: MessageLocation[] };

export type MoveTarget =
  | { kind: "archive" } | { kind: "trash" } | { kind: "spam" } | { kind: "inbox" }
  | { kind: "folder"; folderId: FolderId };

export type FolderSyncState = {
  uidValidity: number | null;
  uidNext: number | null;
  highestModseq: string | null;
  syncedMinUid: number | null;
  lastSyncAt: number | null;
};

export type ReminderStatus = "pending" | "fired" | "replied" | "cancelled";
export type Reminder = { id: number; accountId: AccountId; threadId: ThreadId | null; messageId: string; remindAt: number; status: ReminderStatus };
