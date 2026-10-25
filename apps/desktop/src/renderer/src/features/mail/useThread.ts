import type { ThreadDetail, ThreadId } from "@flint/core";
import { useFlintQuery } from "../../lib/hooks";

/** The open thread. `thread` is undefined until the requested id has loaded, so a previous thread never shows under a new header. */
export function useThread(id: ThreadId | null): { thread: ThreadDetail | undefined; error: Error | undefined; refetch: () => void } {
  const q = useFlintQuery((api) => api.getThread(id as ThreadId), [id], { enabled: id !== null, threadId: id ?? undefined });
  return { thread: q.data && q.data.id === id ? q.data : undefined, error: id === null ? undefined : q.error, refetch: q.refetch };
}
