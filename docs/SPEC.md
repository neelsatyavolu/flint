# Flint: specification

Flint is a free desktop mail client with Spark's layout and features, AI help that runs on the user's own ChatGPT (Codex) or Grok subscription, read receipts that don't report false opens, and a CLI so local agents can read and act on mail. Everything is free: no paid tier, no Flint account, no AI bill.

Reference screenshots of Spark (the layout to follow) are described in `DESIGN.md` §4–5. Visual rules live in `DESIGN.md`; this file covers behavior and architecture.

## 1. Goals

- IMAP/SMTP for any provider, Gmail via Google OAuth (XOAUTH2), Gmail via app password.
- Spark layout and features: unified inbox with per-account inboxes, Smart/Focused inbox with Notifications and Newsletters bundles, Home screen, pins, snooze, send later, undo send, follow-up reminders, templates, signatures per account, rules (sorting), blocked senders, folders/labels, search with operators, keyboard shortcuts, split and full-screen layouts, light and dark themes.
- Read receipts per recipient with no false positives (§6).
- AI features through `@neelsatyavolu/shared-ai-auth`: summarize thread, write reply, quick replies, compose from prompt, rewrite, translate, ask your inbox, AI categorization second opinion.
- `flint` CLI + local agent API: list, read, search, draft, send (with approval), act on mail, receipts, AI tasks, event stream. Every agent call is logged in Agent Activity.
- Fast: local SQLite cache, optimistic actions, virtualized lists, first paint from cache before any network.

Non-goals for v1: Exchange/EWS, Microsoft OAuth, calendar, team features (shared inbox, delegation, comments), meeting transcription, mobile apps, link-click tracking, end-to-end encryption.

Anti-goals: a receipt that says "opened" when nobody opened it; storing raw IP addresses on the receipts service; any network call from the renderer that can leak that the user opened a message they sent; agents sending mail without the user's say-so when settings say "ask".

## 2. Architecture

pnpm monorepo, TypeScript everywhere, Node ≥ 22.5 (Electron 45 ships Node 24). SQLite through the built-in `node:sqlite` (FTS5 is available; no native modules).

```
packages/core        @flint/core — all mail logic, runs in the Electron main process (and in tests)
  src/types.ts         domain types (FROZEN — see §9)
  src/api.ts           FlintApi interface + METHOD_TIERS (FROZEN)
  src/db/              schema (FROZEN), openDb/migrate/tx
  src/store/           repositories and queries over the schema (threads, messages, drafts, settings, ...)
  src/search/          search query parser (operators) → SQL + FTS
  src/threading/       thread key resolution (Gmail X-GM-THRID, else References/In-Reply-To/subject)
  src/categorize/      people / notifications / newsletters heuristics
  src/rules/           rule matching and actions
  src/mail/            IMAP sync engine (imapflow), SMTP (nodemailer), MIME build/parse, autoconfig, Google OAuth
  src/sanitize/        HTML sanitization + tracker stripping for display
  src/receipts/        client for the receipts service: register, inject pixels, poll events, derive status
  src/ai/              Responses API streaming, token storage, tasks and prompts
  src/scheduler/       timers: send queue (undo send, send later), snooze wake-ups, reminders, receipt polling
  src/agent/           agent API server (HTTP over a Unix socket) dispatching to FlintApi
  src/service/         FlintService implements FlintApi by composing the modules above
  src/platform.ts      Platform interface the host provides (secrets, paths, openExternal, notify)
apps/desktop         Electron app (electron-vite): main, preload, React renderer
apps/cli             `flint` CLI (commander) talking to the agent API
services/receipts    Cloudflare Worker + D1: pixel endpoint, classification, event API
```

### Platform interface (`packages/core/src/platform.ts`)

The host (Electron main, the CLI tests, unit tests) passes this to `FlintService`. Core never imports Electron.

```ts
export interface Platform {
  dataDir: string;                       // ~/Library/Application Support/Flint (FLINT_DATA_DIR overrides)
  downloadsDir: string;
  secrets: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void> };
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  notify(n: { title: string; body: string; threadId?: number }): void;
  appVersion: string;
}
```

Secret keys: `account:<id>` → JSON `{ password }` or `{ accessToken, refreshToken, expiresAt }`; `ai:tokens` → shared-ai-auth `Tokens` JSON; `receipts:credentials` → `{ installId, secret }`. Desktop implements secrets with Electron `safeStorage` (encrypted file `<dataDir>/secrets.bin`).

### Process model

- Electron main hosts `FlintService` (sync, scheduler, AI, agent API server).
- Renderer reaches it only through `window.flint` (preload `contextBridge`), a typed proxy over a single `ipcRenderer.invoke('flint:call', method, args)` channel. Main checks `method ∈ FLINT_METHODS` before dispatch. Events arrive on `flint:event`.
- Renderer: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP. Main blocks every renderer request to the receipts endpoint host (`session.webRequest.onBeforeRequest`) so the user can never trip their own pixel.
- Mail HTML renders in `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc=…>` with a CSP meta tag (`default-src 'none'; img-src data: cid: https: (only when allowed); style-src 'unsafe-inline'`). No scripts. Links open in the system browser via `setWindowOpenHandler` / `will-navigate` interception.

## 3. Mail engine (`src/mail`)

- **Accounts.** `addAccount` runs `testConnection` first (IMAP login + SMTP verify) and fails with a clear message. Autoconfig: known providers table (gmail, googlemail, outlook/hotmail/live, yahoo, icloud/me/mac, fastmail, zoho, proton bridge at 127.0.0.1:1143/1025, aol), then Mozilla ISPDB (`https://autoconfig.thunderbird.net/v1.1/<domain>`), then MX lookup to detect Google Workspace / Microsoft 365, then `imap.<domain>`/`smtp.<domain>` guesses.
- **Gmail with app password:** provider `gmail`, auth `password`, imap.gmail.com:993, smtp.gmail.com:465.
- **Google OAuth:** Desktop-app OAuth client supplied in Settings (`settings.google.clientId/clientSecret`) or env `FLINT_GOOGLE_CLIENT_ID` / `FLINT_GOOGLE_CLIENT_SECRET`. Loopback redirect `http://127.0.0.1:<ephemeral port>/oauth2callback`, PKCE S256, scopes `https://mail.google.com/ openid email profile`, `access_type=offline`, `prompt=consent`. Email and name from the ID token. IMAP and SMTP use XOAUTH2; refresh 5 minutes before expiry; refresh failure → sync state `auth_error` with "Sign in again" in the UI.
- **Sync model.**
  - One imapflow client per account for commands plus one IDLE client on INBOX (Gmail: All Mail is the source of truth, IDLE on INBOX triggers an All Mail incremental). Reconnect with backoff (5s → 5min). Offline → state `offline`.
  - Folders from LIST with special-use; roles mapped (`\Inbox`→inbox, `\Sent`, `\Drafts`, `\Trash`, `\Junk`→spam, `\Archive`, `\All`→all, `\Flagged`, `\Important`). Name heuristics when special-use is missing ("Sent Items", "Deleted Items", "Junk E-mail", ...).
  - **Gmail:** sync `[Gmail]/All Mail`, `[Gmail]/Spam`, `[Gmail]/Trash`. Use `X-GM-MSGID`, `X-GM-THRID`, `X-GM-LABELS`; map labels to folder rows (create folder rows for user labels) in `message_folders`. INBOX membership = `\Inbox` label. Do not also sync INBOX/Sent as separate folders (no duplicates).
  - **Generic IMAP:** sync INBOX, Sent, Drafts, Archive, Spam, Trash and user folders (user folders lazily, on first open, then kept in sync).
  - Initial sync: newest first, envelopes + flags + bodystructure + selected headers (`References`, `In-Reply-To`, `List-Unsubscribe`, `List-Unsubscribe-Post`, `List-Id`, `Precedence`, `Auto-Submitted`, `X-Flint-Ref`) for `settings.sync.initialDays` (default 90), in batches of 200, emitting progress and `mail_changed` per batch so the list fills while syncing. Bodies (text + html, not attachments) prefetched for the last `bodiesForRecentDays` (default 14) in inbox; others on demand in `getThread`.
  - Incremental: UIDVALIDITY change → resync folder. New mail: `UID uid_next:*`. Flag changes: CONDSTORE `CHANGEDSINCE` when available, else re-fetch flags for the synced window in chunks. Expunges: QRESYNC vanished when available, else compare `UID SEARCH` against local UIDs in the window. Poll every 2 minutes when IDLE isn't available.
  - Each new message: thread key (§4), category (§4), contacts update, blocked-sender and rule evaluation, FTS insert, `new_mail` event (only for inbox, people category or rule-notify, not muted, not from me).
- **Actions** are optimistic: update the store, emit `mail_changed`, enqueue the IMAP operation; on failure revert and emit a toast. Gmail archive = remove `\Inbox` label; generic archive = MOVE to the archive folder (create "Archive" when missing). Trash = MOVE to trash. Spam = MOVE to spam. Pin = `\Flagged`. Read = `\Seen`. Undo tokens store the inverse operation for 30s.
- **Send** (via scheduler): build MIME with nodemailer's MailComposer: multipart/alternative (text + html), inline images (cid) for signature images, attachments, `Message-ID: <random@sender-domain>`, `In-Reply-To`/`References` for replies, `X-Flint-Ref` with the tracked ref when tracked. Tracking details in §6. After send: APPEND the clean copy to Sent (Gmail and other servers that auto-save sent mail: first find copies by `HEADER Message-ID` and delete them, so Sent holds exactly one clean copy), mark the source message `\Answered`, delete the server draft copy.
- **Drafts** save locally on every change (debounced 800ms in the UI) and to the server Drafts folder every 10s while edited, replacing the previous server copy.

## 4. Threading, categories, search, rules

- **Thread key:** Gmail `gm:<X-GM-THRID>`. Otherwise `mid:<root>` where root = first entry of `References`, else `In-Reply-To`, else own Message-ID; if a message has none of those and its normalized subject (strip `re:`, `fwd:`, `aw:`, `sv:`, `[list]` prefixes) matches a thread with a message within 14 days that shares a participant, join it. When a later message links two existing threads, merge them.
- **Thread rollups** (`threads.last_date`, `subject`, `category`, `pinned`) are recomputed by the store after every message insert/update/delete in that thread. List queries compute counts with indexed subqueries.
- **Categories:** newsletters = has `List-Unsubscribe` or `List-Id` and not a person you've written to; notifications = sender local part matches `no-?reply|notifications?|alerts?|updates?|mailer-daemon|bounce|donotreply|info|support|team|hello` or `Auto-Submitted` ≠ no or `Precedence: bulk|list|junk` (without list headers); people = everything else and anyone in contacts with `sent_count > 0` (always wins). A rule action `category` overrides. Optional AI second opinion when `settings.ai.autoCategorize` and the heuristics disagree.
- **Search operators:** `from:` `to:` `cc:` `subject:` `has:attachment` `is:unread` `is:read` `is:pinned` `is:snoozed` `in:<inbox|sent|drafts|trash|spam|archive|folder name>` `before:YYYY-MM-DD` `after:YYYY-MM-DD` `account:<email>`, quoted phrases, `-term` negation; bare words go to FTS5 (prefix match on the last word for search-as-you-type). Results are threads, newest first.
- **Rules:** evaluated on new mail in order; conditions over from/to/cc/subject/body/any_recipient/list_id/has_attachment; actions move/archive/trash/mark_read/pin/category/mute/notify. `applyRules` re-runs over inbox mail.
- **Blocked senders:** a message whose From matches is moved to trash on the server and listed in the Blocked view (view = messages in trash whose sender is blocked) so nothing is lost; unblocking moves the last 30 days of their mail back to the inbox.

## 5. Scheduler (`src/scheduler`)

One timer wheel in the service (tick ≤ 1s granularity using a single setTimeout to the next due item, re-armed on change):
- `scheduled_sends`: `pending` rows due → send. Undo window = `settings.compose.undoSendSeconds`. Retries with backoff 3 times, then `failed` + toast. Agent-requested sends land as `awaiting_approval` when `settings.agents.send = 'ask'`.
- Snooze: at `snoozed_until`, clear it, set `resurfaced_at = now`, mark the latest message unread, notify.
- Reminders: at `remind_at`, if no message from someone other than the user arrived in the thread after the sent message, set `resurfaced_at`, notify "No reply from Carla yet", status `fired`; else `replied`.
- Receipts polling: every 60s while any tracked message is younger than 30 days (every 10s for the first 10 minutes after a send).
- All timers survive restarts (state is in the DB; the wheel is rebuilt on start).

## 6. Read receipts (`services/receipts` + `packages/core/src/receipts`)

### Principles
1. **Per-recipient tokens.** Each recipient (To, Cc, Bcc, excluding the user's own addresses and aliases) gets its own copy over SMTP with a unique 128-bit token (base64url, 22 chars) in the pixel URL. Headers are identical across copies (same To/Cc, same Message-ID); only the envelope recipient and the pixel differ. Bcc copies carry no Bcc header.
2. **Only the service sees hits; the app classifies nothing it can't know.** The service classifies every hit at request time from user agent, ASN/organization, timing and fingerprints, and stores events with a kind. Only `open` counts.
3. **The user never trips their own pixel.** The Sent copy is clean (no pixel), server-saved copies are replaced (§3), the desktop app blocks the receipts host, the app pings `/v1/seen` with its public-IP fingerprint every 10 minutes, and hits matching a sender fingerprint within 24h of a ping are `self`.

### Pixel
- `<img src="https://<endpoint>/i/<token>.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />` placed as the first element inside `<body>` (Gmail clips long messages at ~102KB; a pixel at the end would vanish).
- Response: 43-byte transparent GIF, `Cache-Control: no-store, no-cache, must-revalidate, private, max-age=0`, `Pragma: no-cache`, `Expires: 0`. Unknown tokens get the same GIF (no oracle).

### Classification (pure function `classify(hit, context)` in `services/receipts/src/classify.ts`, fully unit-tested)
Inputs: user agent, `request.cf.asn`, `request.cf.asOrganization`, country/city, seconds since the message was registered, HMAC fingerprint of IP (`HMAC(salt, ip)` — raw IPs are never stored), sender fingerprints seen recently, previous events for the token.
Order of checks:
1. `self` — fingerprint matches the registering request or a recent `/v1/seen` ping from this install.
2. `prefetch` — Apple Mail Privacy Protection: Apple's MPP proxy hits (Apple ASN 714 / 6185, iCloud Private Relay egress ranges, UA patterns Apple's proxy uses). Sets the recipient to `unknowable` with note "Apple Mail Privacy Protection loads images for every message, so opens can't be confirmed". A later real open from a non-Apple client still upgrades the status.
3. `scanner` — security gateways and link/image scanners: hits within 60s of registration from datacenter/security ASNs or orgs (Microsoft 8075 without an Outlook client UA, Google Cloud, AWS, Azure, Proofpoint, Mimecast, Barracuda, Cisco IronPort, Trend Micro, Sophos, Fortinet, Forcepoint, Symantec/Broadcom, Zscaler, Cloudflare email security) or UAs of known scanners; also any hit with HEAD method.
4. `bot` — empty UA, curl/wget/python/Go-http-client/Java/okhttp/axios/node-fetch/headless browsers, link preview bots (Slackbot, Discordbot, facebookexternalhit, TelegramBot, WhatsApp, Twitterbot, LinkedInBot).
5. `duplicate` — same fingerprint + client within 10s of a counted open (repeat render).
6. `open` — everything else, with `client` derived: `GoogleImageProxy` → Gmail (opens are proxied on view; Gmail caches, so later opens may not be seen: counts are a lower bound), `YahooMailProxy` → Yahoo Mail, Outlook/`Microsoft Outlook`/`ms-office` → Outlook, Thunderbird, Apple Mail (non-MPP UA from a residential ASN), Spark, Superhuman, etc.; device from UA.
- `possiblyForwarded`: a counted open whose fingerprint and client differ from the recipient's first counted open and arrives more than 1h later (forwards and quoted replies carry the pixel). The status stays `opened` (someone with the mail opened it); the UI says "Opened · may have been forwarded".
- Research the current Apple MPP, Gmail, Yahoo, Outlook and scanner signatures before finalizing; record sources in `services/receipts/README.md`.

### App-side status per recipient
`replied` (a message from that address arrives in the thread) > `opened` (≥1 counted open) > `unknowable` (only prefetch events) > `sent`. `untracked` for self/aliases or when registration failed (the mail still sends; the UI says "Receipts unavailable for this message").

### Service API (Worker + D1, JSON, CORS closed)
- `POST /v1/install` → `{ installId, secret }`. Rate-limited per IP fingerprint (10/hour). Stores `sha256(secret)`.
- Auth for everything else: `Authorization: Bearer <installId>.<secret>`.
- `POST /v1/messages` `{ ref, recipients: [{ token }] }` → 201. Max 100 recipients. Records registration time and the caller's fingerprint as a sender fingerprint.
- `DELETE /v1/messages/:ref` → stop tracking (tokens return the GIF, hits are not stored).
- `POST /v1/seen` → records the caller's fingerprint as a sender fingerprint (24h TTL).
- `GET /v1/events?after=<cursor>&limit=500` → `{ events: [{ id, token, at, kind, client, device, country, city, fingerprint }], cursor }` (fingerprint is a per-install re-hash so it can be compared but not reversed).
- `GET /i/:token.gif` → pixel (also `/i/:token` without extension).
- Cron: delete events and messages older than 180 days; delete sender fingerprints older than 24h.
- The endpoint is configurable (`settings.receipts.endpoint`), so anyone can deploy their own Worker for free. README documents `wrangler d1 create`, migrations and deploy.

## 7. AI (`src/ai`)

- Connect flow uses shared-ai-auth: `generatePkce`, `authorizeUrl`, `parseCallback`, `exchangeCode`, `refreshTokens`, `loadModels`, `selectModels`. Codex: main listens on `http://localhost:1455/auth/callback` (the redirect the Codex client uses) to finish automatically and also accepts a pasted callback URL. Grok: the user pastes the displayed code. Tokens in `secrets['ai:tokens']`, refreshed before expiry, preserving rotated refresh tokens (`previous`).
- Streaming via the Responses API: port `~/Documents/GitHub/mullwell/lib/ai/stream.ts` and `sse.ts` (Codex: `https://chatgpt.com/backend-api/codex/responses` with the account id header; Grok: `https://api.x.ai/v1/responses`), drop the Next.js `server-only` imports, keep the retry behavior, no web search for mail tasks.
- Tasks and prompts in `src/ai/tasks.ts`. Each validates input, builds a system prompt and a bounded context (thread text trimmed to the newest ~12k tokens, quoted text and signatures stripped), and streams. Writing tasks use `settings.ai.writingStyle` and match the thread language unless `replyLanguage` is set. Output for drafts is HTML-safe plain paragraphs (the composer converts to HTML).
  - `summarize`: 2–4 sentences plus "Action needed:" bullet list when there are asks or dates. Cached in `kv_cache` by thread id + latest message id.
  - `reply` / `quickReplies` (3 options, each ≤ 12 words, JSON) / `compose` / `rewrite` / `translate`.
  - `ask`: retrieval over the local store (parse the question into a search, FTS top 20 threads, include snippets and dates), answer in prose with citations; emits a `citations` chunk listing the threads used.
- AI is off until the user connects a provider; every AI UI shows "Connect ChatGPT or Grok in Settings → +AI" when not connected.

## 8. Agent API and CLI

- Server in main: HTTP over a Unix socket at `<dataDir>/agent.sock` (chmod 600) and a bearer token in `<dataDir>/agent-token` (chmod 600, 32 random bytes hex, created on first run). The CLI reads both (honours `FLINT_DATA_DIR`).
- `POST /v1/call` `{ method, params: unknown[], agent?: string }` → `{ ok: true, result } | { ok: false, error: { code, message } }`. `method` must be in `FLINT_METHODS`; tier from `METHOD_TIERS`: `admin` always rejected, `modify` per `settings.agents.modify`, `send` per `settings.agents.send` (`ask` → the scheduled send is created as `awaiting_approval` and the result says so; the user approves in Agent Activity). Every call (including reads) writes an `agent_activity` row with a one-line summary ("Read thread 'Freelancing Cycle 3'", "Archived 3 threads", "Queued mail to cindy@… for approval") and emits an `agent_activity` event.
- `GET /v1/events` → server-sent events of `FlintEvent` (excluding `ai` chunks of runs the agent didn't start).
- When the app isn't running, the CLI prints "Flint isn't running. Open Flint, then try again." and exits 2.
- CLI commands (all support `--json`; human output is compact tables; `--as <agent-name>` labels activity, default from `FLINT_AGENT` env or `cli`):
  - `flint status` · `flint accounts`
  - `flint list [--view inbox|pinned|sent|drafts|archive|trash|spam|snoozed] [--account <email>] [--unread] [--focused] [--category people|notifications|newsletters] [--limit N]`
  - `flint read <threadId> [--raw]` (prints messages as text; HTML converted to readable text) · `flint search "<query>" [--limit N]`
  - `flint draft --to a@b --subject s --body "text" [--cc ..] [--bcc ..] [--account email] [--body-file path]` · `flint reply <threadId> --body "..." [--all]` · `flint forward <threadId> --to ..`
  - `flint send <draftId> [--at "2026-10-26 09:00"]` · `flint send --to .. --subject .. --body ..` (draft + send in one)
  - `flint archive|trash|pin|unpin|read|unread|spam <threadId...>` · `flint snooze <threadId> <when>` (`2h`, `tomorrow`, ISO date) · `flint move <threadId> <folder>`
  - `flint receipts [<trackedId>]` · `flint summarize <threadId>` · `flint ask "<question>"` · `flint watch` (stream events as JSON lines) · `flint activity`
- Installing the CLI: Settings → Agents → "Install flint command" symlinks `/usr/local/bin/flint` (or `~/.local/bin/flint` when not writable) to the bundled CLI.

## 9. Contracts (frozen)

`packages/core/src/types.ts`, `packages/core/src/api.ts` and `packages/core/src/db/schema.ts` are shared contracts. Agents working in parallel must not edit them. If one is truly wrong, note it in your final report with the exact change you need; the integrator applies it.

## 10. Quality bar

- TypeScript strict. No `any` in exported signatures. Validate all inputs at boundaries (IPC args, agent API params, worker requests, AI JSON outputs) with zod.
- Tests with vitest next to the code (`*.test.ts`). Core and the receipts worker aim for 80%+ line coverage on logic modules. Real IMAP/SMTP tests run against GreenMail (`packages/core/test/greenmail.ts` downloads `greenmail-standalone-1.6.15.jar` into `.cache/` and starts it on random ports; Java 8 is installed).
- No `console.log` in shipped code; use the `log` helper in `packages/core/src/log.ts` (writes to `<dataDir>/logs/flint.log` and stderr in dev).
- Errors shown to users follow DESIGN.md §8 voice.
- Never log message bodies, tokens or passwords.

## 11. Shortcuts

`c` compose · `r` reply · `a` reply all · `f` forward · `e` archive (done) · `#` / `Backspace` trash · `s` pin · `h` snooze · `l` send later (in composer) · `u` toggle read · `!` spam · `m` mute · `j`/`k` next/previous thread · `↑`/`↓` move selection · `Enter`/`o` open · `Esc` back/close · `/` or `⌘F` search · `⌘K` command palette · `⌘Enter` send · `⌘⇧Z` undo · `g i` inbox · `g s` sent · `g d` drafts · `g p` pins · `g h` home · `⌘1…9` switch account inbox · `⌘,` settings · `⌘\` toggle sidebar · `?` shortcut sheet.
