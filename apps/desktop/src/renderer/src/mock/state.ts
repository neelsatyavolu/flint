import type {
  AgentSkillStatus,
  Account, AccountId, AgentActivity, AiStatus, Category, Draft, Folder, FolderId, MessageView, Rule, ReceiptDetail,
  ScheduledSend, Settings, Signature, SyncStatus, Template, ThreadId, TrackedMessage,
} from "@flint/core";

export type ThreadLocation = "inbox" | "archive" | "trash" | "spam" | "sent" | "drafts";

export type MThread = {
  id: ThreadId;
  accountId: AccountId;
  subject: string;
  category: Category;
  pinned: boolean;
  muted: boolean;
  snoozedUntil: number | null;
  resurfacedAt: number | null;
  location: ThreadLocation;
  folderIds: FolderId[];
  blocked: boolean;
  messages: MessageView[];
  draftIds: number[];
};

export type MockState = {
  accounts: Account[];
  folders: Folder[];
  threads: MThread[];
  drafts: Draft[];
  scheduled: ScheduledSend[];
  signatures: Signature[];
  templates: Template[];
  rules: Rule[];
  blocked: { pattern: string; createdAt: number }[];
  tracked: TrackedMessage[];
  receipts: Record<number, ReceiptDetail>;
  activity: AgentActivity[];
  skill: AgentSkillStatus;
  settings: Settings;
  ai: AiStatus;
  sync: SyncStatus[];
  ids: Record<string, number>;
  /** Mail older than the synced window. Moves into `threads` through loadOlder and searchServer. */
  older: MThread[];
};

export function nextId(state: MockState, key: string): number {
  const n = (state.ids[key] ?? 0) + 1;
  state.ids[key] = n;
  return n;
}

export function plainSnippet(text: string, max = 140): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Immutable deep merge for settings patches. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(out[k]) && isPlainObject(v) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

const QUEUED = new Set(["pending", "awaiting_approval", "sending"]);

/** Drafts that were sent or queued leave the Drafts view. */
export function liveDrafts(state: MockState): MockState["drafts"] {
  const queued = new Set(state.scheduled.filter((s) => QUEUED.has(s.status)).map((s) => s.draftId));
  return state.drafts.filter((d) => !queued.has(d.id));
}
