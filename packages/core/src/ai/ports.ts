import type { SecretStore } from "../platform";
import type { Address, Settings, ThreadId } from "../types";

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
  getDraft?(id: number): Promise<{ subject: string; text: string } | null>;
  cacheGet(key: string): string | null;
  cacheSet(key: string, value: string, ttlMs: number): void;
  now(): number;
  /** IANA zone for dates shown to the model. Defaults to the system zone. */
  timeZone?: string;
  fetch?: typeof fetch;
}
