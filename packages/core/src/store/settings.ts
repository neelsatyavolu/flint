import { z } from "zod";
import { logger } from "../log";
import { FlintError, NOTIFICATION_SOUNDS, type DeepPartial, type Settings } from "../types";
import type { Sql } from "./sql";

const log = logger("store.settings");

export const DEFAULT_SETTINGS: Settings = {
  appearance: { layout: "split", theme: "system", avatars: "everywhere", senderLogos: true, senderPhotos: false, emailAppearance: "match", previewLines: 1, density: "comfortable", accountColors: true },
  inbox: { focused: true, sort: "newest", markReadOnOpen: "instant", afterArchive: "next", blockTrackers: true, remoteImages: "known_senders" },
  compose: { undoSendSeconds: 10, defaultSignatureByAccount: {}, defaultReplySignatureByAccount: {}, plainTextOnly: false },
  receipts: { enabled: true, defaultOn: true, endpoint: "", notifyOnOpen: true },
  notifications: { enabled: true, scope: "people", sound: true, soundName: "default", preview: "sender_subject", badge: "unified_unread", disabledAccounts: [] },
  ai: { enabled: true, provider: null, model: null, autoSummarize: true, smartReplies: true, autoCategorize: false, writingStyle: "", replyLanguage: "" },
  agents: { enabled: true, modify: "allow", send: "ask" },
  sync: { initialDays: 90, bodiesForRecentDays: 14 },
  google: { clientId: "", clientSecret: "" },
  updates: { mode: "ask" },
};

const sections = {
  appearance: z.object({
    layout: z.enum(["split", "full"]), theme: z.enum(["system", "dark", "light"]), avatars: z.enum(["everywhere", "list", "off"]),
    senderLogos: z.boolean(), senderPhotos: z.boolean(), emailAppearance: z.enum(["match", "light"]), previewLines: z.union([z.literal(0), z.literal(1), z.literal(2)]), density: z.enum(["comfortable", "compact"]), accountColors: z.boolean(),
  }),
  inbox: z.object({
    focused: z.boolean(), sort: z.enum(["newest", "oldest"]), markReadOnOpen: z.enum(["instant", "delay", "never"]),
    afterArchive: z.enum(["next", "previous", "list"]), blockTrackers: z.boolean(), remoteImages: z.enum(["always", "known_senders", "never"]),
  }),
  compose: z.object({
    undoSendSeconds: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(20), z.literal(30)]),
    defaultSignatureByAccount: z.record(z.string(), z.number().int().nullable()),
    defaultReplySignatureByAccount: z.record(z.string(), z.number().int().nullable()), plainTextOnly: z.boolean(),
  }),
  receipts: z.object({ enabled: z.boolean(), defaultOn: z.boolean(), endpoint: z.string().max(500), notifyOnOpen: z.boolean() }),
  notifications: z.object({
    enabled: z.boolean(), scope: z.enum(["people", "all", "none"]), sound: z.boolean(), soundName: z.enum(NOTIFICATION_SOUNDS),
    preview: z.enum(["sender_subject", "sender_subject_line", "none"]), badge: z.enum(["unified_unread", "people_unread", "off"]),
    disabledAccounts: z.array(z.string().max(100)).max(200),
  }),
  ai: z.object({
    enabled: z.boolean(), provider: z.enum(["codex", "grok"]).nullable(), model: z.string().max(200).nullable(), autoSummarize: z.boolean(),
    smartReplies: z.boolean(), autoCategorize: z.boolean(), writingStyle: z.string().max(4000), replyLanguage: z.string().max(100),
  }),
  agents: z.object({ enabled: z.boolean(), modify: z.enum(["allow", "deny"]), send: z.enum(["allow", "ask", "deny"]) }),
  sync: z.object({ initialDays: z.number().int().min(1).max(3650), bodiesForRecentDays: z.number().int().min(0).max(3650) }),
  google: z.object({ clientId: z.string().max(500), clientSecret: z.string().max(500) }),
  updates: z.object({ mode: z.enum(["auto", "ask", "manual"]) }),
};

export const settingsSchema = z.object(sections).strict();
const optionalPartial = <T extends z.ZodObject>(o: T) => o.partial().strict().optional();
export const settingsPatchSchema = z.object({
  appearance: optionalPartial(sections.appearance), inbox: optionalPartial(sections.inbox), compose: optionalPartial(sections.compose),
  receipts: optionalPartial(sections.receipts), notifications: optionalPartial(sections.notifications), ai: optionalPartial(sections.ai),
  agents: optionalPartial(sections.agents), sync: optionalPartial(sections.sync), google: optionalPartial(sections.google),
  updates: optionalPartial(sections.updates),
}).strict();

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep merge of plain objects; arrays and scalars in `patch` replace. Returns a new object. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch === undefined ? base : patch) as T;
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

const KEY = "app";

export class SettingsRepo {
  constructor(protected q: Sql) {}

  #stored(): unknown {
    const row = this.q.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", KEY);
    if (!row) return {};
    try { return JSON.parse(row.value); } catch { return {}; }
  }

  /** Stored overrides merged over DEFAULT_SETTINGS. Invalid stored data falls back to defaults. */
  getSettings(): Settings {
    const merged = deepMerge(DEFAULT_SETTINGS, this.#stored());
    const parsed = settingsSchema.safeParse(merged);
    if (parsed.success) return parsed.data as Settings;
    log.warn("stored settings invalid, using defaults");
    return structuredClone(DEFAULT_SETTINGS);
  }

  /** Validates the patch, deep-merges it into the stored overrides and returns the new full settings. */
  updateSettings(patch: DeepPartial<Settings>): Settings {
    const parsed = settingsPatchSchema.safeParse(patch);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new FlintError("invalid", `That setting is not valid${issue ? `: ${issue.path.join(".")}` : ""}.`);
    }
    const overrides = deepMerge(this.#stored() as Plain, parsed.data);
    const full = settingsSchema.safeParse(deepMerge(DEFAULT_SETTINGS, overrides));
    if (!full.success) throw new FlintError("invalid", "That combination of settings is not valid.");
    this.q.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", KEY, JSON.stringify(overrides));
    return full.data as Settings;
  }
}
