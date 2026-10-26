import type { Address, Category, Invite, ReceiptEventKind, ReceiptStatus } from "@flint/core";

export type AcctKey = "northwind" | "orbit" | "gmail";

export type SeedOpen = { minsAfter: number; kind: ReceiptEventKind; client: string | null; device: string | null; location: string | null; counted: boolean };
export type SeedRecipient = { who: Address; status: ReceiptStatus; opens?: SeedOpen[]; repliedMinsAfter?: number; forwarded?: boolean; note?: string };

export type SeedMsg = {
  from: Address | "me";
  to?: Address[];
  cc?: Address[];
  minsAgo: number;
  text: string;
  /** Overrides the HTML derived from `text`. */
  html?: string;
  /** No HTML part at all (plain text mail). */
  textOnly?: boolean;
  attach?: { filename: string; contentType: string; size: number; inline?: boolean }[];
  unsub?: { url?: string; mailto?: string; oneClick: boolean };
  remoteImages?: "allowed" | "blocked";
  hasTrackers?: boolean;
  /** Append a quoted copy of the previous message. */
  quote?: boolean;
  signature?: "plain" | "short" | "rich";
  track?: SeedRecipient[];
  seen?: boolean;
  /** A calendar invitation carried by this message, built from the seed's "now". */
  invite?: (now: number) => Invite;
};

export type SeedThread = {
  acct: AcctKey;
  subject: string;
  category?: Category;
  pinned?: boolean;
  muted?: boolean;
  location?: "inbox" | "archive" | "trash" | "spam";
  unread?: boolean;
  labels?: string[];
  blocked?: boolean;
  msgs: SeedMsg[];
};

export const DAY = 1440;
