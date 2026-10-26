// Shared by the sync hook and the lazy path: decode a calendar part, parse it, store the result for the message.
import type { Account, AccountId, AttachmentInfo, MessageRowId } from "../types";
import { INVITE_PARSER_VERSION, type InviteStore, type StoredInvite } from "./contracts";
import { parseInvite } from "./parse";

/** Largest calendar part we read; real invitations are a few KB (a huge .ics is not an invitation). */
export const MAX_ICS_BYTES = 1024 * 1024;

export const isCalendarAttachment = (a: Pick<AttachmentInfo, "contentType" | "filename">): boolean =>
  /^(text\/calendar|application\/ics|text\/x-vcalendar|application\/x-ics)$/i.test(a.contentType) || /\.ics$/i.test(a.filename);

/** The addresses that count as "you" for an account: its email and aliases, lower case. */
export const ownAddressesOf = (account: Pick<Account, "email" | "aliases">): string[] =>
  [...new Set([account.email, ...account.aliases].map((a) => a.trim().toLowerCase()).filter(Boolean))];

/** UTF-8 text of a downloaded calendar part (BOM removed); falls back to Latin-1 when the bytes are not valid UTF-8. */
export function decodeIcs(data: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/^﻿/, "");
  } catch {
    return data.toString("latin1");
  }
}

export type ParseAndStore = {
  store: Pick<InviteStore, "saveInvite">;
  accountId: AccountId; messageId: MessageRowId; ownAddresses: readonly string[]; now: number;
};

/** Parses calendar text and stores it for the message. Null (nothing stored) when the text holds no event. */
export function parseAndStore(ics: string, o: ParseAndStore): StoredInvite | null {
  const invite = parseInvite(ics, { ownAddresses: o.ownAddresses, now: o.now });
  if (!invite) return null;
  const record = { messageId: o.messageId, accountId: o.accountId, invite, ics, parserVersion: INVITE_PARSER_VERSION, parsedAt: o.now };
  o.store.saveInvite(record);
  return record;
}
