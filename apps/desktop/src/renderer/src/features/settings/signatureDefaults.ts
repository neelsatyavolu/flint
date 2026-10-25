import type { AccountId, DeepPartial, Settings, Signature } from "@flint/core";
import { defaultSignatureFor, signaturesForAccount } from "../compose/signature";

export type DefaultKind = "new" | "reply";
type Compose = Settings["compose"];

/** What a default picker shows: a signature id, null for an explicit None, "unset" when nothing is chosen yet. */
export type PickerValue = number | null | "unset";

/**
 * The picker's value for an account, following the same rules as the composer: the settings choice,
 * else the signature flagged as default. A choice pointing at a deleted signature counts as no choice.
 */
export function pickerValue(signatures: Signature[], compose: Compose, accountId: AccountId, kind: DefaultKind): PickerValue {
  const mode = kind === "new" ? "new" : "reply";
  const choice = defaultSignatureFor(signatures, accountId, mode, compose);
  if (choice) return choice.id;
  const map = kind === "reply" && accountId in (compose.defaultReplySignatureByAccount ?? {}) ? compose.defaultReplySignatureByAccount : compose.defaultSignatureByAccount;
  return map[accountId] === null ? null : "unset";
}

/** The settings patch for choosing `value` (a signature id, or null for None) as an account's default. */
export function defaultPatch(kind: DefaultKind, accountId: AccountId, value: number | null): DeepPartial<Settings> {
  return kind === "new"
    ? { compose: { defaultSignatureByAccount: { [accountId]: value } } }
    : { compose: { defaultReplySignatureByAccount: { [accountId]: value } } };
}

/** True when an account has signatures to choose from but no default for new mail or replies yet. */
export function needsDefaultHint(signatures: Signature[], compose: Compose, accountId: AccountId): boolean {
  if (signaturesForAccount(signatures, accountId).length === 0) return false;
  return (["new", "reply"] as const).some((kind) => pickerValue(signatures, compose, accountId, kind) === "unset");
}
