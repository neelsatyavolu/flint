import type { AccountId, Signature } from "@flint/core";

export type DefaultsMap = Record<AccountId, number | null>;

export type SignaturePlan = {
  /** Other signatures that must drop a default flag because the saved one took it. */
  demote: Signature[];
  /** New settings.compose.defaultSignatureByAccount, or null when unchanged. */
  map: DefaultsMap | null;
};

/**
 * Keeps "default for new mail" and "default for replies" unique per account scope, and keeps
 * settings.compose.defaultSignatureByAccount (the new-mail default) in step with the flags.
 */
export function planSignatureSave(all: Signature[], saved: Signature, current: DefaultsMap): SignaturePlan {
  const demote: Signature[] = [];
  for (const other of all) {
    if (other.id === saved.id || other.accountId !== saved.accountId) continue;
    const dropNew = saved.defaultNew && other.defaultNew;
    const dropReply = saved.defaultReply && other.defaultReply;
    if (dropNew || dropReply) {
      demote.push({ ...other, defaultNew: dropNew ? false : other.defaultNew, defaultReply: dropReply ? false : other.defaultReply });
    }
  }

  let map: DefaultsMap | null = null;
  const acct = saved.accountId;
  if (acct !== null) {
    if (saved.defaultNew && current[acct] !== saved.id) map = { ...current, [acct]: saved.id };
    else if (!saved.defaultNew && current[acct] === saved.id) map = { ...current, [acct]: null };
  }
  return { demote, map };
}

/** Map after deleting a signature: accounts that pointed at it fall back to none. */
export function mapAfterDelete(current: DefaultsMap, id: number): DefaultsMap | null {
  const hit = Object.entries(current).filter(([, v]) => v === id);
  if (hit.length === 0) return null;
  return { ...current, ...Object.fromEntries(hit.map(([k]) => [k, null])) };
}
