// Frozen schema shared by every core module. Changes go through a new entry in
// MIGRATIONS (never edit an applied one). Times are unix epoch milliseconds.
// JSON columns hold the shapes named in ../types.ts.

export const MIGRATIONS: readonly string[] = [
  /* 1 */ `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL,              -- 'gmail' | 'imap'
    auth_kind TEXT NOT NULL,             -- 'oauth_google' | 'password'
    imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL, imap_secure INTEGER NOT NULL,
    smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL, smtp_secure INTEGER NOT NULL,
    username TEXT NOT NULL,
    color TEXT,                          -- account color coding, null = auto
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    aliases TEXT NOT NULL DEFAULT '[]',  -- JSON string[] of extra send-as addresses
    created_at INTEGER NOT NULL
  );

  CREATE TABLE folders (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    delimiter TEXT,
    role TEXT,                           -- MailboxRole or NULL for user folders/labels
    special_use TEXT,                    -- raw IMAP special-use flag
    uid_validity INTEGER,
    uid_next INTEGER,
    highest_modseq TEXT,                 -- bigint as string
    synced_min_uid INTEGER,              -- lowest UID we have synced (window start)
    sync_enabled INTEGER NOT NULL DEFAULT 1,
    last_sync_at INTEGER,
    UNIQUE (account_id, path)
  );

  CREATE TABLE threads (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    thread_key TEXT NOT NULL,            -- 'gm:<X-GM-THRID>' or 'mid:<root Message-ID>'
    subject TEXT NOT NULL DEFAULT '',
    last_date INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'people', -- 'people' | 'notifications' | 'newsletters'
    pinned INTEGER NOT NULL DEFAULT 0,   -- mirrors \\Flagged on any message
    muted INTEGER NOT NULL DEFAULT 0,
    snoozed_until INTEGER,               -- hidden from inbox until then
    resurfaced_at INTEGER,               -- set when snooze/reminder fires; sorts as last_date
    UNIQUE (account_id, thread_key)
  );
  CREATE INDEX threads_last ON threads (last_date DESC);

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    thread_id INTEGER NOT NULL REFERENCES threads(id),
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE, -- folder the UID belongs to
    uid INTEGER NOT NULL,
    gm_msgid TEXT,
    gm_thrid TEXT,
    message_id TEXT,                     -- Message-ID header without <>
    in_reply_to TEXT,
    refs TEXT NOT NULL DEFAULT '[]',     -- JSON string[]
    subject TEXT NOT NULL DEFAULT '',
    from_json TEXT NOT NULL DEFAULT '[]',-- JSON Address[]
    to_json TEXT NOT NULL DEFAULT '[]',
    cc_json TEXT NOT NULL DEFAULT '[]',
    bcc_json TEXT NOT NULL DEFAULT '[]',
    reply_to_json TEXT NOT NULL DEFAULT '[]',
    date INTEGER NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    seen INTEGER NOT NULL DEFAULT 0,
    flagged INTEGER NOT NULL DEFAULT 0,
    answered INTEGER NOT NULL DEFAULT 0,
    draft INTEGER NOT NULL DEFAULT 0,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    headers_json TEXT NOT NULL DEFAULT '{}', -- selected headers: list-unsubscribe, list-id, precedence, auto-submitted, x-flint-ref
    body_state TEXT NOT NULL DEFAULT 'none', -- 'none' | 'full'
    text_body TEXT,
    html_body TEXT,                      -- raw (unsanitized) HTML; sanitize on read
    category TEXT,                       -- per-message category before thread rollup
    UNIQUE (folder_id, uid)
  );
  CREATE INDEX messages_thread ON messages (thread_id, date);
  CREATE INDEX messages_msgid ON messages (account_id, message_id);
  CREATE INDEX messages_gm ON messages (account_id, gm_msgid);
  CREATE INDEX messages_date ON messages (date DESC);

  -- Which folders/labels a message is in. Generic IMAP: exactly its folder_id.
  -- Gmail: one row per X-GM-LABELS entry that maps to a known folder.
  CREATE TABLE message_folders (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, folder_id)
  );
  CREATE INDEX message_folders_folder ON message_folders (folder_id, message_id);

  CREATE TABLE attachments (
    id INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    part TEXT NOT NULL,                  -- IMAP body part id
    filename TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    content_id TEXT,
    inline INTEGER NOT NULL DEFAULT 0,
    cached_path TEXT
  );

  CREATE VIRTUAL TABLE messages_fts USING fts5 (
    subject, from_text, to_text, body_text,
    content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2'
  );                                     -- rowid = messages.id

  CREATE TABLE drafts (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    from_address TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'new',    -- 'new' | 'reply' | 'replyAll' | 'forward'
    source_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL,
    to_json TEXT NOT NULL DEFAULT '[]',
    cc_json TEXT NOT NULL DEFAULT '[]',
    bcc_json TEXT NOT NULL DEFAULT '[]',
    subject TEXT NOT NULL DEFAULT '',
    html TEXT NOT NULL DEFAULT '',
    quoted_html TEXT NOT NULL DEFAULT '', -- quoted original for replies/forwards
    attachments_json TEXT NOT NULL DEFAULT '[]', -- JSON DraftAttachment[]
    signature_id INTEGER REFERENCES signatures(id) ON DELETE SET NULL,
    track INTEGER NOT NULL DEFAULT 1,    -- read receipts on/off
    remind_at INTEGER,                   -- follow-up reminder if no reply
    in_reply_to TEXT, refs TEXT NOT NULL DEFAULT '[]',
    server_uid INTEGER,                  -- copy saved in server Drafts folder
    created_by TEXT NOT NULL DEFAULT 'user', -- 'user' | 'agent:<name>' | 'ai'
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE scheduled_sends (
    id INTEGER PRIMARY KEY,
    draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    send_at INTEGER NOT NULL,            -- now + undo delay, or the chosen send-later time
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'awaiting_approval' | 'sending' | 'sent' | 'failed' | 'cancelled'
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    message_id TEXT,                     -- Message-ID used for the sent mail
    requested_by TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX scheduled_due ON scheduled_sends (status, send_at);

  CREATE TABLE reminders (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,            -- Message-ID of the sent mail awaiting reply
    remind_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' -- 'pending' | 'fired' | 'replied' | 'cancelled'
  );

  CREATE TABLE signatures (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    html TEXT NOT NULL DEFAULT '',
    account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE, -- NULL = any account
    default_new INTEGER NOT NULL DEFAULT 0,
    default_reply INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    html TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE rules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE, -- NULL = all accounts
    match TEXT NOT NULL DEFAULT 'all',   -- 'all' | 'any'
    conditions_json TEXT NOT NULL DEFAULT '[]', -- JSON RuleCondition[]
    actions_json TEXT NOT NULL DEFAULT '[]',    -- JSON RuleAction[]
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE blocked_senders (
    pattern TEXT PRIMARY KEY,            -- lowercase address or '@domain'
    created_at INTEGER NOT NULL
  );

  CREATE TABLE contacts (
    email TEXT PRIMARY KEY,              -- lowercase
    name TEXT NOT NULL DEFAULT '',
    sent_count INTEGER NOT NULL DEFAULT 0,     -- times the user wrote to them
    received_count INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE tracked_messages (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ref TEXT NOT NULL UNIQUE,            -- random id shared with the receipts service
    message_id TEXT NOT NULL,            -- Message-ID header of the sent mail
    thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL,
    subject TEXT NOT NULL DEFAULT '',
    sent_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'active' -- 'active' | 'unregistered' (service unreachable) | 'stopped'
  );

  CREATE TABLE tracked_recipients (
    id INTEGER PRIMARY KEY,
    tracked_id INTEGER NOT NULL REFERENCES tracked_messages(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'sent', -- ReceiptStatus
    first_open_at INTEGER,
    last_open_at INTEGER,
    open_count INTEGER NOT NULL DEFAULT 0,
    replied_at INTEGER,
    note TEXT                            -- e.g. 'Apple Mail Privacy Protection'
  );

  CREATE TABLE receipt_events (
    id INTEGER PRIMARY KEY,
    remote_id TEXT NOT NULL UNIQUE,      -- event id from the service
    recipient_id INTEGER NOT NULL REFERENCES tracked_recipients(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,                  -- ReceiptEventKind
    client TEXT,                         -- 'Gmail', 'Apple Mail', 'Outlook', ...
    device TEXT,                         -- 'desktop' | 'mobile' | 'web' | null
    location TEXT,                       -- 'City, Country' when known
    fingerprint TEXT,                    -- opaque hash used to spot forwards
    counted INTEGER NOT NULL DEFAULT 0   -- 1 when it counted as a real open
  );

  CREATE TABLE agent_activity (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    agent TEXT NOT NULL,                 -- name the agent gave (--as) or 'cli'
    method TEXT NOT NULL,                -- FlintApi method name
    summary TEXT NOT NULL,               -- human-readable one-liner
    status TEXT NOT NULL,                -- 'ok' | 'error' | 'awaiting_approval' | 'approved' | 'denied'
    detail_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX agent_activity_at ON agent_activity (at DESC);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL                  -- JSON
  );

  CREATE TABLE kv_cache (
    key TEXT PRIMARY KEY,                -- e.g. 'ai:summary:<threadId>:<lastMessageId>'
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  /* 2: indexes the store queries lean on (were created ad hoc by store/indexes.ts) */ `
  CREATE INDEX IF NOT EXISTS threads_account_last ON threads (account_id, last_date DESC);
  CREATE INDEX IF NOT EXISTS threads_pinned ON threads (pinned) WHERE pinned = 1;
  CREATE INDEX IF NOT EXISTS threads_snoozed ON threads (snoozed_until) WHERE snoozed_until IS NOT NULL;
  CREATE INDEX IF NOT EXISTS messages_account_date ON messages (account_id, date);
  CREATE INDEX IF NOT EXISTS messages_reply ON messages (account_id, in_reply_to);
  CREATE INDEX IF NOT EXISTS messages_thread_seen ON messages (thread_id, seen);
  CREATE INDEX IF NOT EXISTS tracked_thread ON tracked_messages (thread_id);
  CREATE INDEX IF NOT EXISTS tracked_msgid ON tracked_messages (account_id, message_id);
  CREATE INDEX IF NOT EXISTS tracked_recipients_tracked ON tracked_recipients (tracked_id);
  CREATE INDEX IF NOT EXISTS receipt_events_recipient ON receipt_events (recipient_id, at);
  CREATE INDEX IF NOT EXISTS drafts_thread ON drafts (thread_id);
  CREATE INDEX IF NOT EXISTS reminders_due ON reminders (status, remind_at);
  CREATE INDEX IF NOT EXISTS folders_role ON folders (role, account_id);
  `,
  /* 3: durable outbox. A server operation is recorded before it runs and removed when it finishes, so an action the app was
        killed in the middle of is replayed at the next start. */ `
  CREATE TABLE pending_ops (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                  -- 'seen' | 'flagged' | 'archive' | 'trash' | 'spam' | 'unspam' | 'move_inbox' | 'move_folder'
    arg TEXT,                            -- JSON: boolean for seen/flagged, folder id for move_folder
    message_ids TEXT NOT NULL,           -- JSON number[] of messages.id
    created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
  `,
  /* 4: why a message the user asked to track went out without tracking (shown as the recipients' note) */ `
  ALTER TABLE tracked_messages ADD COLUMN untracked_reason TEXT;
  `,
  /* 5: who set a message's category. NULL = the heuristics (or the AI second opinion); 'rule' = a rule's category action;
        'manual' = the user. Re-categorizing leaves 'rule' and 'manual' values alone. */ `
  ALTER TABLE messages ADD COLUMN category_source TEXT;
  `,
  /* 6: Message-ID (without <>) of the draft's copy in the server Drafts folder, so the Drafts view can tell the copy from the
        local draft behind it (on Gmail the copy is synced from All Mail under another UID). */ `
  ALTER TABLE drafts ADD COLUMN server_message_id TEXT;
  `,
];
