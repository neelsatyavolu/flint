import type { SecretStore } from "../platform";
import type { Address, Settings, ThreadId } from "../types";

/** One thread as the digest, bundle summary and needs-reply features see it. */
export type AiThreadBrief = {
  threadId: ThreadId;
  subject: string;
  /** Date of the newest message. */
  date: number;
  /** Sender of the newest message. */
  from: Address;
  /** Start of the newest message's own text (quotes and signature removed). */
  lastText: string;
  unreadCount: number;
  messageCount: number;
  /** True when the user wrote the newest message. */
  lastFromMe: boolean;
  /** True when the newest message is flagged as answered. */
  answered: boolean;
  self?: { name: string; addresses: string[] };
};

export type AiThreadListKind = "unread_people" | "needs_reply_candidates" | "notifications" | "newsletters";

/** Search request for the OR-ranked retrieval behind "ask your inbox". */
export type AiRankedQuery = {
  /** Distinctive words, already lightly stemmed. Each matches as a prefix. */
  terms: string[];
  /** Quoted phrases, matched exactly. */
  phrases: string[];
  /** Sender addresses or names; any may match. */
  from: string[];
  after?: number;
  before?: number;
  limit: number;
};

/** What the AI module needs from the host. Keeps ai/ independent of the store. */
export interface AiContext {
  getSettings(): Settings;
  secrets: SecretStore;
  getThreadForAi(threadId: ThreadId): Promise<{
    subject: string;
    messages: { from: Address; to: Address[]; date: number; text: string; fromMe?: boolean }[];
    /** The mailbox owner, so prompts can say who "the user" is. */
    self?: { name: string; addresses: string[] };
  } | null>;
  searchForAi(query: string, limit: number): Promise<
    { threadId: ThreadId; subject: string; date: number; from: Address; snippet: string }[]
  >;
  /** BM25-ranked, OR-matched search with a recency boost. Falls back to searchForAi when the host has none. */
  rankedSearchForAi?(query: AiRankedQuery): Promise<
    { threadId: ThreadId; subject: string; date: number; from: Address; snippet: string }[]
  >;
  /** Recent threads for the digest, bundle summaries and needs-reply detection. */
  listThreadsForAi?(kind: AiThreadListKind, limit: number): Promise<AiThreadBrief[]>;
  getDraft?(id: number): Promise<{ subject: string; text: string } | null>;
  cacheGet(key: string): string | null;
  cacheSet(key: string, value: string, ttlMs: number): void;
  now(): number;
  /** IANA zone for dates shown to the model. Defaults to the system zone. */
  timeZone?: string;
  fetch?: typeof fetch;
}
