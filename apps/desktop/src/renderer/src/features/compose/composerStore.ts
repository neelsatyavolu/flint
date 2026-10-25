import { useSyncExternalStore } from "react";
import type { Draft, DraftInit } from "@flint/core";
import { flint } from "../../lib/api";

export type ComposerInit = DraftInit | { draftId: number };
export type ComposerEntry = {
  id: string;
  init: ComposerInit;
  minimized: boolean;
  /** Set once the draft exists on the backend. */
  draftId?: number;
  /** Subject or recipient hint for the minimized chip. */
  label?: string;
};

let composers: ComposerEntry[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const drafts = new Map<string, Promise<Draft>>();

const set = (next: ComposerEntry[]) => {
  composers = next;
  listeners.forEach((l) => l());
};

const update = (id: string, patch: Partial<ComposerEntry>) =>
  set(composers.map((c) => (c.id === id ? { ...c, ...patch } : c)));

/** Opens a composer and minimizes whichever one was open. Opening a draft that is already open restores it. */
export function openComposer(init: ComposerInit): void {
  if ("draftId" in init) {
    const open = composers.find((c) => c.draftId === init.draftId || ("draftId" in c.init && c.init.draftId === init.draftId));
    if (open) {
      restoreComposer(open.id);
      return;
    }
  }
  const id = `composer-${++counter}`;
  set([...composers.map((c) => (c.minimized ? c : { ...c, minimized: true })), { id, init, minimized: false }]);
}

export function closeComposer(id: string): void {
  drafts.delete(id);
  set(composers.filter((c) => c.id !== id));
}

export function minimizeComposer(id: string): void {
  update(id, { minimized: true });
}

/** Brings one composer to the front; the others minimize. */
export function restoreComposer(id: string): void {
  set(composers.map((c) => ({ ...c, minimized: c.id !== id })));
}

export function setComposerMeta(id: string, meta: Pick<ComposerEntry, "draftId" | "label">): void {
  const entry = composers.find((c) => c.id === id);
  if (!entry || (entry.draftId === meta.draftId && entry.label === meta.label)) return;
  update(id, meta);
}

/**
 * Creates or loads the draft for a composer exactly once, even when React mounts the component twice
 * (StrictMode) or the panel is minimized and restored.
 */
export function ensureDraft(entry: Pick<ComposerEntry, "id" | "init">): Promise<Draft> {
  const existing = drafts.get(entry.id);
  if (existing) return existing;
  const init = entry.init;
  const created = "draftId" in init ? flint.getDraft(init.draftId) : flint.createDraft(init);
  drafts.set(entry.id, created);
  created.catch(() => drafts.delete(entry.id));
  return created;
}

/** Forgets the cached draft of a composer that isn't in the store (inline replies). */
export function releaseDraft(id: string): void {
  drafts.delete(id);
}

export function useComposers(): ComposerEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => composers,
  );
}

/** Test helper: resets module state. */
export function resetComposerStore(): void {
  composers = [];
  counter = 0;
  drafts.clear();
  listeners.forEach((l) => l());
}
