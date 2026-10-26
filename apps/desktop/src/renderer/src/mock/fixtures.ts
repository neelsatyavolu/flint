import type { AgentActivity, AiStatus, Account, Rule, Settings, Signature, Template } from "@flint/core";
import { SIGNATURES } from "./bodies";
import { ME, ME_NAME } from "./people";
import type { AcctKey } from "./seedTypes";

export const ACCOUNT_IDS: Record<AcctKey, string> = { northwind: "acc_northwind", orbit: "acc_orbit", gmail: "acc_gmail" };

export function makeAccounts(now: number): Account[] {
  const base = { imapPort: 993, imapSecure: true, smtpSecure: true, enabled: true, aliases: [] as string[], createdAt: now - 200 * 86400_000, showInUnified: true, avatarSource: null, avatarUpdatedAt: null };
  return [
    { ...base, id: ACCOUNT_IDS.northwind, email: ME.northwind, name: ME_NAME, provider: "gmail", authKind: "oauth_google", color: "#5f8fb5", sortOrder: 0, imapHost: "imap.gmail.com", smtpHost: "smtp.gmail.com", smtpPort: 465, username: ME.northwind, aliases: ["hello@northwind.dev"] },
    { ...base, id: ACCOUNT_IDS.orbit, email: ME.orbit, name: ME_NAME, provider: "imap", authKind: "password", color: "#b58a5f", sortOrder: 1, imapHost: "imap.studio-orbit.com", smtpHost: "smtp.studio-orbit.com", smtpPort: 587, smtpSecure: false, username: ME.orbit },
    { ...base, id: ACCOUNT_IDS.gmail, email: ME.gmail, name: ME_NAME, provider: "gmail", authKind: "oauth_google", color: "#6aa883", sortOrder: 2, imapHost: "imap.gmail.com", smtpHost: "smtp.gmail.com", smtpPort: 465, username: ME.gmail },
  ];
}

export const defaultSettings = (): Settings => ({
  appearance: { layout: "split", theme: "system", avatars: "everywhere", senderLogos: false, senderPhotos: false, emailAppearance: "match", previewLines: 1, density: "comfortable", accountColors: true },
  inbox: { focused: true, sort: "newest", markReadOnOpen: "instant", afterArchive: "next", blockTrackers: true, remoteImages: "known_senders" },
  compose: { undoSendSeconds: 10, defaultSignatureByAccount: { [ACCOUNT_IDS.northwind]: 2, [ACCOUNT_IDS.orbit]: 3, [ACCOUNT_IDS.gmail]: 1 }, defaultReplySignatureByAccount: { [ACCOUNT_IDS.northwind]: null, [ACCOUNT_IDS.orbit]: 3, [ACCOUNT_IDS.gmail]: 1 }, plainTextOnly: false },
  receipts: { enabled: true, defaultOn: true, endpoint: "https://receipts.flint.example", notifyOnOpen: true },
  notifications: { enabled: true, scope: "people", sound: false, soundName: "default", preview: "sender_subject", badge: "unified_unread", disabledAccounts: [] },
  ai: { enabled: true, provider: "codex", model: "gpt-5.5", autoSummarize: true, smartReplies: true, autoCategorize: false, writingStyle: "Short, warm, direct. No filler.", replyLanguage: "" },
  agents: { enabled: true, modify: "allow", send: "ask" },
  sync: { initialDays: 90, bodiesForRecentDays: 14 },
  google: { clientId: "", clientSecret: "" },
  updates: { mode: "ask" },
  codes: { enabled: true, notify: true, autoCopy: false, autofill: true, shortcut: "Control+Option+V" },
});

export const defaultAi = (): AiStatus => ({
  provider: "codex", connected: true, model: "gpt-5.5", enabled: true,
  models: [{ id: "gpt-5.5", label: "GPT-5.5" }, { id: "gpt-5.5-mini", label: "GPT-5.5 mini" }],
});

export const makeSignatures = (): Signature[] => [
  { id: 1, name: "Short", html: SIGNATURES.short, accountIds: [ACCOUNT_IDS.gmail], defaultNew: true, defaultReply: true },
  { id: 2, name: "Northwind (links and logo)", html: SIGNATURES.rich, accountIds: [ACCOUNT_IDS.northwind], defaultNew: true, defaultReply: false },
  { id: 3, name: "Studio Orbit", html: SIGNATURES.plain.replace("Northwind", "Studio Orbit"), accountIds: [ACCOUNT_IDS.orbit], defaultNew: true, defaultReply: true },
];

export const makeTemplates = (): Template[] => [
  { id: 1, name: "Meeting request", subject: "Can we find 30 minutes?", html: "<p>Hi,</p><p>Could we find 30 minutes this week to talk through the next steps? I am free Tuesday and Thursday afternoon.</p><p>Thanks,<br>Alex</p>" },
  { id: 2, name: "Intro and next steps", subject: "Nice to meet you", html: "<p>Hi,</p><p>Great to meet you. Here is what I will do next: send the notes tonight and a first draft by Friday. Tell me if I missed anything.</p>" },
  { id: 3, name: "Polite decline", subject: "Thank you, but not this time", html: "<p>Hi,</p><p>Thank you for thinking of me. I have to pass this time, but I appreciate the offer.</p>" },
];

export const makeRules = (): Rule[] => [
  { id: 1, name: "Pin anything from Carla", enabled: true, accountId: null, match: "all", conditions: [{ field: "from", op: "contains", value: "carla@brightfield.studio" }], actions: [{ type: "pin" }], sortOrder: 0 },
  { id: 2, name: "Archive CI failures", enabled: true, accountId: ACCOUNT_IDS.northwind, match: "all", conditions: [{ field: "from", op: "equals", value: "notifications@gitforge.dev" }, { field: "subject", op: "contains", value: "Run failed" }], actions: [{ type: "mark_read" }, { type: "archive" }], sortOrder: 1 },
  { id: 3, name: "Receipts to Receipts folder", enabled: false, accountId: null, match: "any", conditions: [{ field: "subject", op: "contains", value: "receipt" }, { field: "subject", op: "contains", value: "invoice" }], actions: [{ type: "move", folderPath: "Receipts" }], sortOrder: 2 },
];

export function makeActivity(now: number): AgentActivity[] {
  const min = 60_000;
  const rows: Omit<AgentActivity, "id">[] = [
    { at: now - 4 * min, agent: "claude-code", method: "sendDraft", summary: "Queued mail to nina@bluepine.example for approval", status: "awaiting_approval", detail: { draftId: 9001, to: "nina@bluepine.example", subject: "Contract questions" } },
    { at: now - 11 * min, agent: "claude-code", method: "getThread", summary: "Read thread 'Freelancing Cycle 3'", status: "ok", detail: {} },
    { at: now - 26 * min, agent: "claude-code", method: "listThreads", summary: "Listed 20 unread threads in Inbox", status: "ok", detail: {} },
    { at: now - 3 * 60 * min, agent: "cron-digest", method: "archive", summary: "Archived 3 threads", status: "ok", detail: { count: 3 } },
    { at: now - 5 * 60 * min, agent: "cli", method: "searchThreads", summary: "Searched 'invoice 2291'", status: "ok", detail: {} },
    { at: now - 26 * 60 * min, agent: "claude-code", method: "createDraft", summary: "Drafted reply to Priya Raman", status: "ok", detail: {} },
    { at: now - 28 * 60 * min, agent: "cron-digest", method: "sendDraft", summary: "Tried to send mail to dana.rivera@gmail.com", status: "denied", detail: { reason: "Denied by you" } },
    { at: now - 50 * 60 * min, agent: "cli", method: "updateSettings", summary: "Tried to change settings", status: "error", detail: { error: "Agents can't change settings." } },
    { at: now - 52 * 60 * min, agent: "claude-code", method: "sendDraft", summary: "Sent mail to rodney@brightfield.studio", status: "approved", detail: {} },
  ];
  return rows.map((r, i) => ({ ...r, id: rows.length - i }));
}
