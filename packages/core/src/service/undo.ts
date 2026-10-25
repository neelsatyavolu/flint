import { nanoid } from "nanoid";
import type { MessageLocation, ThreadSnapshot } from "../store/types";
import { FlintError, type MessageRowId } from "../types";
import type { ActionReport, ServerActions } from "../mail/actions";

export const UNDO_TTL_MS = 30_000;

/** Brings the server back to the pre-change state. `locs` are the affected messages as the store holds them after the local restore. */
export type InverseOp = (actions: ServerActions, locs: MessageLocation[], snapshot: ThreadSnapshot) => Promise<ActionReport>;

export type UndoEntry = {
  label: string;
  snapshot: ThreadSnapshot;
  /** Messages whose server state the action changed (ActionResult.locations). */
  affected: MessageRowId[];
  inverse?: InverseOp;
};

type Stored = UndoEntry & { expiresAt: number };

/** Undo tokens for thread actions. Entries live 30 seconds and can be used once. */
export class UndoRegistry {
  #entries = new Map<string, Stored>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(opts: { ttlMs?: number; now?: () => number } = {}) {
    this.#ttlMs = opts.ttlMs ?? UNDO_TTL_MS;
    this.#now = opts.now ?? Date.now;
  }

  register(entry: UndoEntry): string {
    this.#prune();
    const token = nanoid(16);
    this.#entries.set(token, { ...entry, expiresAt: this.#now() + this.#ttlMs });
    return token;
  }

  /** Removes and returns the entry. Throws when the token is unknown, used or expired. */
  take(token: string): UndoEntry {
    this.#prune();
    const found = this.#entries.get(token);
    if (!found) throw new FlintError("not_found", "That can't be undone any more.");
    this.#entries.delete(token);
    const { expiresAt: _expiresAt, ...entry } = found;
    return entry;
  }

  discard(token: string): void {
    this.#entries.delete(token);
  }

  get size(): number {
    this.#prune();
    return this.#entries.size;
  }

  #prune(): void {
    const now = this.#now();
    for (const [token, entry] of this.#entries) if (entry.expiresAt <= now) this.#entries.delete(token);
  }
}
