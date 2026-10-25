import { FlintError } from "@flint/core/types";
import type { Category, ThreadId } from "@flint/core";
import type { MThread, MockState } from "./state";

const CATEGORIES: readonly Category[] = ["people", "notifications", "newsletters"];

type Deps = {
  state: MockState;
  /** Applies `fn` to the threads, emits mail_changed and returns an undo token (the mock's `mutate`). */
  mutate: (ids: ThreadId[], fn: (t: MThread) => MThread) => { undoToken: string };
};

const senderOf = (t: MThread): string | null => t.messages.find((m) => !m.isFromMe)?.from[0]?.address.toLowerCase() ?? null;

/** Mock of FlintApi.setCategory: files threads (and with `sender`, the sender's other inbox mail) under a category. */
export function mockCategoryApi({ state, mutate }: Deps) {
  return {
    async setCategory(ids: ThreadId[], category: Category, opts?: { sender?: boolean }) {
      if (!CATEGORIES.includes(category)) throw new FlintError("invalid", "Pick People, Notifications or Newsletters.");
      const senders = new Set(opts?.sender ? state.threads.filter((t) => ids.includes(t.id)).map(senderOf) : []);
      const all = new Set(ids);
      if (senders.size > 0) for (const t of state.threads) if (t.location === "inbox" && senders.has(senderOf(t))) all.add(t.id);
      return mutate([...all], (t) => ({ ...t, category }));
    },
  };
}
