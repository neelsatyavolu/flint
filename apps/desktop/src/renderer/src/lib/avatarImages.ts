import { useEffect, useSyncExternalStore } from "react";
import type { AvatarRef, Settings } from "@flint/core";
import { avatarKey } from "@flint/core/types";
import { flint } from "./api";

/**
 * Profile pictures for accounts and senders. Core does the fetching and caching; this module only batches the asks
 * (one getAvatars call per tick of requests), remembers answers for the session and tells mounted avatars when one arrives.
 */

const BATCH_DELAY_MS = 16;
const MAX_BATCH = 100;
const REFRESH_DEBOUNCE_MS = 250;

const values = new Map<string, string | null>();
const refs = new Map<string, AvatarRef>();
const listeners = new Map<string, Set<() => void>>();
const queued = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** Settings that decide whether pictures are looked up at all. Unknown until the first read finishes. */
let gate: { off: boolean; photos: boolean; logos: boolean } | undefined;
let gateReady: Promise<void> | undefined;
let wired = false;

const readGate = (s: Settings) => ({ off: s.appearance.avatars === "off", photos: s.appearance.senderPhotos, logos: s.appearance.senderLogos });

function notify(key: string): void {
  listeners.get(key)?.forEach((fn) => fn());
}

function mounted(): string[] {
  return [...listeners.entries()].filter(([, set]) => set.size > 0).map(([key]) => key);
}

/** Asks core again for everything on screen. Old pictures stay until the new answer differs. */
function refreshMounted(): void {
  for (const key of mounted()) queued.add(key);
  schedule();
}

function wire(): void {
  if (wired) return;
  wired = true;
  const fallback = () => { gate = { off: false, photos: true, logos: true }; };
  try {
    gateReady = flint.getSettings().then((s) => { gate = readGate(s); }, fallback);
  } catch {
    fallback();
  }
  try {
    flint.subscribe((e) => {
      if (e.type === "settings") {
        const next = readGate(e.settings);
        const changed = !gate || next.off !== gate.off || next.photos !== gate.photos || next.logos !== gate.logos;
        gate = next;
        if (changed) {
          mounted().forEach(notify);
          refreshMounted();
        }
      } else if (e.type === "mail_changed" && e.threadIds.length === 0) {
        // An account photo was set or removed (or an account changed): re-read what is on screen.
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refreshMounted, REFRESH_DEBOUNCE_MS);
      }
    });
  } catch {
    /* no event channel (a stripped-down test api): pictures still load once */
  }
}

function schedule(): void {
  if (timer !== undefined) return;
  timer = setTimeout(() => { timer = undefined; void flush(); }, BATCH_DELAY_MS);
}

async function flush(): Promise<void> {
  await gateReady;
  const keys = [...queued].slice(0, MAX_BATCH);
  keys.forEach((k) => queued.delete(k));
  if (queued.size > 0) schedule();
  if (keys.length === 0 || gate?.off) return;
  let result: Record<string, string | null> = {};
  try {
    result = await flint.getAvatars(keys.map((k) => refs.get(k)!));
  } catch {
    /* initials stay; the next mount or settings change asks again */
  }
  for (const key of keys) {
    const next = result[key] ?? null;
    if (values.get(key) !== next || !values.has(key)) {
      values.set(key, next);
      notify(key);
    }
  }
}

function request(key: string, ref: AvatarRef): void {
  refs.set(key, ref);
  if (values.has(key)) return;
  queued.add(key);
  schedule();
}

/**
 * Profile picture (a data URL) for an account or sender, or null while loading / when there is none (show initials).
 * Honors Settings, Appearance, Show avatars: Off.
 */
export function useAvatarImage(ref: AvatarRef | null): string | null {
  wire();
  const key = ref ? avatarKey(ref) : null;
  const subscribe = (onChange: () => void) => {
    if (!key) return () => undefined;
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(onChange);
    return () => { set!.delete(onChange); };
  };
  const value = useSyncExternalStore(subscribe, () => (key ? values.get(key) ?? null : null), () => null);
  useEffect(() => {
    if (key && ref) request(key, ref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return gate?.off ? null : value;
}

/** Forgets everything. Tests only. */
export function resetAvatarImages(): void {
  values.clear(); refs.clear(); listeners.clear(); queued.clear();
  clearTimeout(timer); clearTimeout(refreshTimer);
  timer = undefined; refreshTimer = undefined; gate = undefined; gateReady = undefined; wired = false;
}
