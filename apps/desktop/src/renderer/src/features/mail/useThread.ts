import { useEffect, useRef } from "react";
import type { ThreadDetail, ThreadId } from "@flint/core";
import { flint } from "../../lib/api";
import { useFlintQuery } from "../../lib/hooks";

const MAX_CACHED = 40;
const MAX_AGE_MS = 60_000;
const cache = new Map<ThreadId, { thread: ThreadDetail; at: number }>();
const inflight = new Map<ThreadId, Promise<ThreadDetail>>();
/** Bumped whenever mail changes for a thread, so a request started before the change cannot cache its older result. */
const generation = new Map<ThreadId, number>();
let allGeneration = 0;
let watching = false;

const generationOf = (id: ThreadId): number => allGeneration + (generation.get(id) ?? 0);

/** Drops cached copies when mail changes, so a prefetched thread never shows an outdated state for long. */
function watch(): void {
  if (watching) return;
  watching = true;
  flint.subscribe((e) => {
    if (e.type !== "mail_changed") return;
    if (e.threadIds.length === 0) {
      cache.clear();
      inflight.clear();
      allGeneration += 1;
    } else {
      for (const id of e.threadIds) {
        cache.delete(id);
        inflight.delete(id);
        generation.set(id, (generation.get(id) ?? 0) + 1);
      }
    }
  });
}

function remember(thread: ThreadDetail): void {
  cache.delete(thread.id);
  cache.set(thread.id, { thread, at: Date.now() });
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as ThreadId);
}

/** The thread as last loaded, if recent. Lets the reader paint a thread the instant it is selected. */
export function peekThread(id: ThreadId): ThreadDetail | undefined {
  const hit = cache.get(id);
  return hit && Date.now() - hit.at < MAX_AGE_MS ? hit.thread : undefined;
}

/** Loads a thread; concurrent callers (a hover prefetch, then the click) share one request. */
export function loadThread(id: ThreadId): Promise<ThreadDetail> {
  watch();
  const pending = inflight.get(id);
  if (pending) return pending;
  const started = generationOf(id);
  const p: Promise<ThreadDetail> = flint.getThread(id).then(
    (t) => {
      // Only the request that is still current clears the entry and may cache; an invalidated one is left alone.
      if (inflight.get(id) === p) inflight.delete(id);
      if (generationOf(id) === started) remember(t);
      return t;
    },
    (err: unknown) => {
      if (inflight.get(id) === p) inflight.delete(id);
      throw err;
    },
  );
  inflight.set(id, p);
  return p;
}

/** Warms the cache for a thread the reader is likely to open next. Errors are ignored. */
export function prefetchThread(id: ThreadId): void {
  if (peekThread(id) || inflight.has(id)) return;
  void loadThread(id).catch(() => undefined);
}

const equalPairs = new WeakMap<ThreadDetail, WeakSet<ThreadDetail>>();

/** Deep equality by JSON, remembered per pair so a re-render does not stringify big threads again. */
function sameThread(a: ThreadDetail, b: ThreadDetail): boolean {
  if (equalPairs.get(a)?.has(b)) return true;
  let same = false;
  try {
    same = JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
  if (same) {
    const set = equalPairs.get(a) ?? new WeakSet<ThreadDetail>();
    set.add(b);
    equalPairs.set(a, set);
  }
  return same;
}

/**
 * The open thread. `thread` is undefined until the requested id has loaded (or a prefetched copy exists), so a
 * previous thread never shows under a new header. A prefetched copy paints at once and the fresh load replaces it
 * only when it differs, keeping the same object so nothing re-renders.
 */
export function useThread(id: ThreadId | null): { thread: ThreadDetail | undefined; error: Error | undefined; refetch: () => void } {
  const q = useFlintQuery((api) => (api === flint ? loadThread(id as ThreadId) : api.getThread(id as ThreadId)), [id], { enabled: id !== null, threadId: id ?? undefined });
  const fresh = q.data && q.data.id === id ? q.data : undefined;
  const held = useRef<ThreadDetail | undefined>(undefined);
  const next = fresh ?? (id !== null ? peekThread(id) : undefined);
  if (next === undefined || held.current?.id !== next.id || (held.current !== next && !sameThread(held.current, next))) held.current = next;
  useEffect(() => {
    if (fresh) remember(fresh);
  }, [fresh]);
  return { thread: held.current && held.current.id === id ? held.current : undefined, error: id === null ? undefined : q.error, refetch: q.refetch };
}
