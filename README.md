# Flint

A free, open-source mail client for macOS. It keeps the three-pane layout people like in Spark, runs its AI on the ChatGPT or Grok subscription you already pay for, has read receipts that only count real opens, and includes a `flint` command so local agents can read and act on your mail.

Website: [flint.xanom.co](https://flint.xanom.co)

## Install

Download the DMG for your Mac from the [latest release](https://github.com/neelsatyavolu/flint/releases/latest): `Flint-arm64.dmg` for Apple silicon, `Flint-x64.dmg` for Intel. Builds are signed with a Developer ID and notarized by Apple.

Flint updates itself. It checks GitHub Releases at launch and every six hours, downloads new versions in the background, and asks before restarting. **Flint → Check for Updates** checks right away.

## What it does

- **Accounts.** Gmail through Google sign-in (no setup) or an app password, Proton Mail through Proton Mail Bridge, and iCloud, Outlook, Fastmail or any IMAP/SMTP server. Settings are filled in automatically for most providers.
- **Smart inbox.** Mail from people comes first. Notifications and newsletters are grouped into bundles. Pins, snooze, send later, undo send, follow-up reminders, mute, rules and templates.
- **Signatures.** Per-account defaults for new mail and replies, one signature shared by several accounts, and a one-click import of your signatures from Spark.
- **Calendar invitations.** A clean card for Google, Outlook, iCloud and Zoom invites: time in your zone, repeats, Join for Meet/Zoom/Teams, guests and their answers, conflicts, and clear Updated and Cancelled states. Yes / Maybe / No updates your calendar through Google Calendar or CalDAV (iCloud, Fastmail, others), whichever account your mail arrives on, and otherwise emails a standard reply to the organizer. Settings → Calendars adds calendars separately from mail accounts.
- **Verification codes.** Sign-in codes in new mail show as a banner, a list chip and a notification with Copy. With Accessibility turned on, Flint suggests the code next to the code field in any app or browser and types it for you (Control+Option+V, which you can change, types the newest code). Codes stay in memory for 10 minutes and are never saved. An optional browser extension is under Settings → Verification codes → Advanced.
- **Read receipts.** Each recipient gets their own copy with a private marker. The receipts service drops opens it can't trust: Apple Mail Privacy Protection prefetches, security scanners, bots, your own opens and repeats. Apple prefetches show as "can't be known", never as "opened". Your Sent folder keeps one clean copy.
- **+AI.** Summaries, reply drafts, rewrites, translation and questions about your inbox, through your own ChatGPT (Codex) or Grok account via [shared-ai-auth](https://github.com/neelsatyavolu/shared-ai-auth). Flint charges nothing. Once you connect a provider, opening a thread asks it for three quick replies and, on threads with three or more messages or 300+ words, a summary card; both can be turned off in Settings → +AI. Home also writes a "Catch me up" summary of your unread mail from people every 3 hours, and only when new mail has arrived; you can turn that off on the card. Otherwise Flint sends nothing to an AI provider unless you use an AI feature. The Needs reply list on Home is worked out on your Mac and works without +AI.
- **Command palette.** ⌘K finds commands, mail, people, folders and settings, with nested pages for snooze, move, theme and more.
- **Agents.** The `flint` command (Settings → Agents → Install) lets local agents list, read, search, draft, archive, snooze and send. Every call shows up in Agent Activity, and sending waits for your approval unless you allow it. **Skill for AI agents** (same page) adds a `flint` [Agent Skill](https://agentskills.io) to Claude Code, Codex, Gemini CLI, Copilot CLI, OpenCode, Grok, Cursor, Factory and Antigravity, so they know the commands without being told.

```sh
flint list --view inbox
flint search "from:carla has:attachment"
flint read 4821
flint reply 4821 --body "Thanks, that works."
```

## Privacy

Mail is cached in a local SQLite database on your Mac. Flint connects to your mail servers, to `flintr.xanom.co` only for read receipts you send (it stores message tokens and hashed, never raw, IP addresses), and to an AI provider only when you use an AI feature or, with a provider connected, for the quick replies and summaries on threads you open and the automatic "Catch me up" on Home. That runs at most every 3 hours, only while +AI is connected and on and "Refresh automatically every 3 hours" is on, and is skipped when no new mail from people has arrived. It sends short excerpts of up to 12 unread threads from people. The receipts service is in `services/receipts`; you can deploy your own and point Settings → Read Receipts at it. See the [privacy policy](https://flint.xanom.co/privacy).

## Build from source

Requires Node 22.5+ and pnpm 10.

```sh
pnpm install
pnpm dev            # run the app with hot reload
pnpm test           # unit and integration tests
scripts/dist.sh     # unsigned .app, .dmg and .zip in apps/desktop/release
```

Layout: `packages/core` (sync, storage, receipts, AI, agent API), `apps/desktop` (Electron + React), `apps/cli` (the `flint` command), `apps/autofill-helper` (the Swift helper that types verification codes), `apps/browser-extension` (the optional codes extension), `apps/ios` (an iOS app, in development and not yet released; notes in `docs/ios`), `services/receipts` (Cloudflare Worker + D1), `site` (flint.xanom.co). `docs/SPEC.md` describes behavior and architecture; `DESIGN.md` is the visual system.

Releases: bump the version in `apps/desktop/package.json` and `AboutSection.tsx`, commit, then run `scripts/release.sh`. It signs and notarizes with credentials from 1Password and publishes the GitHub release the updater reads.

## License

[MIT](LICENSE)
