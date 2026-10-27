// The bundle the Mac sends and the iPhone imports (docs/ios/DESIGN-NOTES.md section 7). Schema v1.
// The builder copies field by field from an allowlist: nothing is spread, so a new field on an Account or a
// Settings object cannot leak into the bundle by accident. Google tokens, AI tokens, receipts credentials, the agent
// token, message bodies and the database never appear here.

import { z } from "zod";
import type { Account, AccountId, Rule, Settings, Signature, Template } from "../types";
import { MAX_BUNDLE_BYTES } from "./frames";

export const BUNDLE_VERSION = 1;
export const MAX_AVATAR_CHARS = 64 * 1024;
export const LIMITS = { accounts: 20, signatures: 100, templates: 200, rules: 500, blockedSenders: 5000, conditions: 20, actions: 20, aliases: 50 } as const;

const text = (max: number) => z.string().max(max);
const server = z.object({ host: text(255).min(1), port: z.number().int().min(1).max(65535), secure: z.boolean() });

const bundleAccount = z.object({
  email: text(320).min(3),
  name: text(200),
  provider: z.enum(["gmail", "imap"]),
  authKind: z.enum(["oauth_google", "password"]),
  imap: server,
  smtp: server,
  username: text(320),
  color: text(32).nullable().optional(),
  aliases: z.array(text(320)).max(LIMITS.aliases),
  showInUnified: z.boolean(),
  sortOrder: z.number().int(),
  avatar: text(MAX_AVATAR_CHARS).optional(),
  password: text(1024).optional(),
});

const ruleCondition = z.object({
  field: z.enum(["from", "to", "cc", "subject", "body", "any_recipient", "list_id", "has_attachment"]),
  op: z.enum(["contains", "equals", "ends_with", "matches", "is_true"]),
  value: text(1000),
});
const ruleAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), folderPath: text(500) }),
  z.object({ type: z.literal("archive") }),
  z.object({ type: z.literal("trash") }),
  z.object({ type: z.literal("mark_read") }),
  z.object({ type: z.literal("pin") }),
  z.object({ type: z.literal("category"), category: z.enum(["people", "notifications", "newsletters"]) }),
  z.object({ type: z.literal("mute") }),
  z.object({ type: z.literal("notify"), enabled: z.boolean() }),
]);

const bundleSettings = z.object({
  compose: z.object({ undoSendSeconds: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(20), z.literal(30)]) }).partial().optional(),
  sync: z.object({ initialDays: z.number().int().min(1).max(3650), bodiesForRecentDays: z.number().int().min(0).max(365) }).partial().optional(),
  inbox: z.object({ focused: z.boolean() }).partial().optional(),
  receipts: z.object({ enabled: z.boolean(), defaultOn: z.boolean(), endpoint: text(512) }).partial().optional(),
  appearance: z.object({ theme: z.enum(["system", "dark", "light"]) }).partial().optional(),
  notifications: z.object({ scope: z.enum(["people", "all", "none"]) }).partial().optional(),
});

export const bundleSchema = z.object({
  v: z.literal(BUNDLE_VERSION),
  createdAt: z.number().int().nonnegative(),
  device: z.object({ name: text(100) }),
  accounts: z.array(bundleAccount).max(LIMITS.accounts),
  signatures: z.array(z.object({
    name: text(200), html: text(200_000), accountEmails: z.array(text(320)).max(LIMITS.accounts), defaultNew: z.boolean(), defaultReply: z.boolean(),
  })).max(LIMITS.signatures),
  templates: z.array(z.object({ name: text(200), subject: text(500), html: text(200_000) })).max(LIMITS.templates),
  rules: z.array(z.object({
    name: text(200), enabled: z.boolean(), accountEmail: text(320).nullable(), match: z.enum(["all", "any"]),
    conditions: z.array(ruleCondition).max(LIMITS.conditions), actions: z.array(ruleAction).max(LIMITS.actions), sortOrder: z.number().int(),
  })).max(LIMITS.rules),
  blockedSenders: z.array(text(320)).max(LIMITS.blockedSenders),
  settings: bundleSettings,
});

export type Bundle = z.infer<typeof bundleSchema>;
export type BundleAccount = z.infer<typeof bundleAccount>;

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

/** Parses and validates bundle bytes. Unknown major versions, oversize input and any schema violation throw BundleError. */
export function parseBundle(json: Buffer | string): Bundle {
  const raw = typeof json === "string" ? Buffer.from(json) : json;
  if (raw.length > MAX_BUNDLE_BYTES) throw new BundleError("Bundle too large.");
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new BundleError("Bundle is not valid JSON.");
  }
  const parsed = bundleSchema.safeParse(value);
  if (!parsed.success) throw new BundleError("Bundle does not match schema v1.");
  return parsed.data;
}

/** What the builder reads from the Mac app. Passwords come from the secret store and are asked for one account at a time. */
export type BundleSource = {
  deviceName(): string;
  listAccounts(): Promise<Account[]>;
  /** The saved app password, or null for accounts without one (Google sign-in). */
  password(accountId: AccountId): Promise<string | null>;
  /** A data URL of the account picture, or null. Larger than MAX_AVATAR_CHARS is left out. */
  avatar?(accountId: AccountId): Promise<string | null>;
  listSignatures(): Promise<Signature[]>;
  listTemplates(): Promise<Template[]>;
  listRules(): Promise<Rule[]>;
  listBlocked(): Promise<{ pattern: string }[]>;
  getSettings(): Promise<Settings>;
  now(): number;
};

/** Accounts whose app password the user can choose to include. Google accounts are not counted. */
export async function countPasswordAccounts(source: Pick<BundleSource, "listAccounts" | "password">): Promise<number> {
  let count = 0;
  for (const account of await source.listAccounts()) {
    if (account.authKind === "password" && (await source.password(account.id))) count++;
  }
  return count;
}

async function bundleAccountOf(source: BundleSource, a: Account, includePasswords: boolean): Promise<BundleAccount> {
  const out: BundleAccount = {
    email: a.email, name: a.name, provider: a.provider, authKind: a.authKind,
    imap: { host: a.imapHost, port: a.imapPort, secure: a.imapSecure },
    smtp: { host: a.smtpHost, port: a.smtpPort, secure: a.smtpSecure },
    username: a.username, aliases: [...a.aliases], showInUnified: a.showInUnified, sortOrder: a.sortOrder,
  };
  if (a.color) out.color = a.color;
  const avatar = a.avatarSource ? await source.avatar?.(a.id) : null;
  if (avatar && avatar.length <= MAX_AVATAR_CHARS) out.avatar = avatar;
  if (includePasswords && a.authKind === "password") {
    const password = await source.password(a.id);
    if (password) out.password = password;
  }
  return out;
}

function pickSettings(s: Settings): Bundle["settings"] {
  return {
    compose: { undoSendSeconds: s.compose.undoSendSeconds },
    sync: { initialDays: s.sync.initialDays, bodiesForRecentDays: s.sync.bodiesForRecentDays },
    inbox: { focused: s.inbox.focused },
    receipts: { enabled: s.receipts.enabled, defaultOn: s.receipts.defaultOn, endpoint: s.receipts.endpoint },
    appearance: { theme: s.appearance.theme },
    notifications: { scope: s.notifications.scope },
  };
}

/** Builds the bundle for one approved session. */
export async function buildBundle(source: BundleSource, opts: { includePasswords: boolean }): Promise<Bundle> {
  const [accounts, signatures, templates, rules, blocked, settings] = await Promise.all([
    source.listAccounts(), source.listSignatures(), source.listTemplates(), source.listRules(), source.listBlocked(), source.getSettings(),
  ]);
  const emailOf = new Map(accounts.map((a) => [a.id, a.email] as const));
  const emails = (ids: AccountId[]): string[] => ids.flatMap((id) => emailOf.get(id) ?? []);
  const bundle: Bundle = {
    v: BUNDLE_VERSION,
    createdAt: source.now(),
    device: { name: source.deviceName().slice(0, 100) },
    accounts: await Promise.all(accounts.filter((a) => a.enabled).map((a) => bundleAccountOf(source, a, opts.includePasswords))),
    signatures: signatures.filter((s) => s.accountIds.length === 0 || emails(s.accountIds).length > 0).map((s) => ({ name: s.name, html: s.html, accountEmails: emails(s.accountIds), defaultNew: s.defaultNew, defaultReply: s.defaultReply })),
    templates: templates.map((t) => ({ name: t.name, subject: t.subject, html: t.html })),
    rules: rules.filter((r) => r.accountId === null || emailOf.has(r.accountId)).map((r) => ({
      name: r.name, enabled: r.enabled, accountEmail: r.accountId ? (emailOf.get(r.accountId) ?? null) : null, match: r.match,
      conditions: r.conditions.map((c) => ({ field: c.field, op: c.op, value: c.value })),
      actions: r.actions.map((x) => ({ ...x })), sortOrder: r.sortOrder,
    })),
    blockedSenders: blocked.map((b) => b.pattern),
    settings: pickSettings(settings),
  };
  return parseBundle(JSON.stringify(bundle));
}
