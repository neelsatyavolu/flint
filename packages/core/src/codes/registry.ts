import { nanoid } from "nanoid";
import type { MessageRowId, ThreadId, VerificationCode } from "../types";
import { CODE_MAX_RECENT, CODE_TTL_MS } from "./contract";

export type NewCode = Omit<VerificationCode, "id" | "expiresAt" | "used">;

/** In-memory store of recent codes. Never persisted. OWNER: detector (extend as needed, keep this interface). */
export interface CodeRegistry {
  /** Adds a code (expires CODE_TTL_MS from now). A second code for the same message replaces the first. */
  add(input: NewCode): VerificationCode;
  /** Valid codes (not expired), newest first. Used ones are included only with `includeUsed`. */
  list(opts?: { includeUsed?: boolean }): VerificationCode[];
  get(id: string): VerificationCode | null;
  /** True when the code existed (and was still valid). */
  markUsed(id: string): boolean;
  forMessage(messageId: MessageRowId): VerificationCode | null;
  forThread(threadId: ThreadId): VerificationCode | null;
  clear(): void;
}

export function createCodeRegistry(now: () => number = Date.now): CodeRegistry {
  let items: VerificationCode[] = [];
  const prune = (): void => {
    const t = now();
    items = items.filter((c) => c.expiresAt > t);
  };
  return {
    add(input) {
      prune();
      const code: VerificationCode = { ...input, id: nanoid(24), expiresAt: now() + CODE_TTL_MS, used: false };
      items = [code, ...items.filter((c) => c.messageId !== input.messageId)].slice(0, CODE_MAX_RECENT);
      return code;
    },
    list(opts = {}) {
      prune();
      return items.filter((c) => opts.includeUsed || !c.used);
    },
    get(id) {
      prune();
      return items.find((c) => c.id === id) ?? null;
    },
    markUsed(id) {
      prune();
      const i = items.findIndex((c) => c.id === id);
      const found = items[i];
      if (!found) return false;
      items = items.map((c, j) => (j === i ? { ...c, used: true } : c));
      return true;
    },
    forMessage(messageId) {
      prune();
      return items.find((c) => c.messageId === messageId) ?? null;
    },
    forThread(threadId) {
      prune();
      return items.find((c) => c.threadId === threadId) ?? null;
    },
    clear() {
      items = [];
    },
  };
}
