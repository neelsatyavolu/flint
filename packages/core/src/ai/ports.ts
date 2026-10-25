import type { SecretStore } from "../platform";
import type { Address, Settings, ThreadId } from "../types";

/** What the AI module needs from the host. Keeps ai/ independent of the store. */
export interface AiContext {
  getSettings(): Settings;
  secrets: SecretStore;
  getThreadForAi(threadId: ThreadId): Promise<{
    subject: string;
    messages: { from: Address; to: Address[]; date: number; text: string }[];
  } | null>;
  searchForAi(query: string, limit: number): Promise<
    { threadId: ThreadId; subject: string; date: number; from: Address; snippet: string }[]
  >;
  getDraft?(id: number): Promise<{ subject: string; text: string } | null>;
  cacheGet(key: string): string | null;
  cacheSet(key: string, value: string, ttlMs: number): void;
  now(): number;
  fetch?: typeof fetch;
}
