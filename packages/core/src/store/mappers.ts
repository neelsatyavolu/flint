import type { Account, Address, Category, Folder, MailboxRole } from "../types";
import { bool, parseJson } from "./sql";

export type AccountRow = {
  id: string; email: string; name: string; provider: string; auth_kind: string;
  imap_host: string; imap_port: number; imap_secure: number; smtp_host: string; smtp_port: number; smtp_secure: number;
  username: string; color: string | null; sort_order: number; enabled: number; aliases: string; created_at: number;
  show_in_unified: number; avatar_source: string | null; avatar_updated_at: number | null; calendar_scope: number;
};

export function rowToAccount(r: AccountRow): Account {
  return {
    id: r.id, email: r.email, name: r.name,
    provider: r.provider as Account["provider"], authKind: r.auth_kind as Account["authKind"],
    imapHost: r.imap_host, imapPort: r.imap_port, imapSecure: bool(r.imap_secure),
    smtpHost: r.smtp_host, smtpPort: r.smtp_port, smtpSecure: bool(r.smtp_secure),
    username: r.username, color: r.color, sortOrder: r.sort_order, enabled: bool(r.enabled),
    aliases: parseJson<string[]>(r.aliases, []), createdAt: r.created_at,
    showInUnified: bool(r.show_in_unified), avatarSource: (r.avatar_source as Account["avatarSource"]) ?? null, avatarUpdatedAt: r.avatar_updated_at, calendarScope: bool(r.calendar_scope),
  };
}

export type FolderRow = { id: number; account_id: string; path: string; name: string; role: string | null; unread?: number; total?: number };

export function rowToFolder(r: FolderRow): Folder {
  return {
    id: r.id, accountId: r.account_id, path: r.path, name: r.name,
    role: (r.role as MailboxRole | null) ?? null, unread: r.unread ?? 0, total: r.total ?? 0,
  };
}

export const addresses = (json: unknown): Address[] => parseJson<Address[]>(json, []);

export const asCategory = (v: unknown): Category | null =>
  v === "people" || v === "notifications" || v === "newsletters" ? v : null;

/** Message-ID without angle brackets, or null. */
export function cleanId(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().replace(/^<+|>+$/g, "").trim();
  return s || null;
}

export function lowerAddr(a: Address | undefined): string {
  return (a?.address ?? "").trim().toLowerCase();
}

/** Whole-word searchable text for an address list: names and addresses. */
export function addressText(list: Address[]): string {
  return list.map((a) => `${a.name} ${a.address}`.trim()).join(" ");
}
