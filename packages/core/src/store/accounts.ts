import { nanoid } from "nanoid";
import { tx } from "../db/open";
import { FlintError, type Account, type AccountId } from "../types";
import { rowToAccount, type AccountRow } from "./mappers";
import type { Sql } from "./sql";

export type NewAccount = Pick<Account, "email" | "provider" | "authKind" | "imapHost" | "imapPort" | "imapSecure" | "smtpHost" | "smtpPort" | "smtpSecure" | "username"> &
  Partial<Pick<Account, "id" | "name" | "color" | "sortOrder" | "enabled" | "aliases" | "createdAt" | "showInUnified">>;

export type AccountPatch = Partial<Omit<Account, "id" | "createdAt">>;

const COLUMNS: Record<keyof AccountPatch, string> = {
  email: "email", name: "name", provider: "provider", authKind: "auth_kind",
  imapHost: "imap_host", imapPort: "imap_port", imapSecure: "imap_secure",
  smtpHost: "smtp_host", smtpPort: "smtp_port", smtpSecure: "smtp_secure",
  username: "username", color: "color", sortOrder: "sort_order", enabled: "enabled", aliases: "aliases",
  showInUnified: "show_in_unified", avatarSource: "avatar_source", avatarUpdatedAt: "avatar_updated_at",
};

export class AccountsRepo {
  constructor(protected q: Sql) {}

  /** True once any message of the account is stored. */
  accountHasMessages(id: AccountId): boolean {
    return this.q.get("SELECT 1 AS x FROM messages WHERE account_id = ? LIMIT 1", id) !== undefined;
  }

  createAccount(input: NewAccount): Account {
    const id = input.id ?? nanoid(12);
    const sortOrder = input.sortOrder ?? (this.q.get<{ n: number }>("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM accounts")?.n ?? 0);
    try {
      this.q.run(
        `INSERT INTO accounts (id, email, name, provider, auth_kind, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, color, sort_order, enabled, aliases, created_at, show_in_unified)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, input.email.trim().toLowerCase(), input.name ?? "", input.provider, input.authKind,
        input.imapHost, input.imapPort, input.imapSecure, input.smtpHost, input.smtpPort, input.smtpSecure,
        input.username, input.color ?? null, sortOrder, input.enabled ?? true,
        JSON.stringify((input.aliases ?? []).map((a) => a.toLowerCase())), input.createdAt ?? Date.now(), input.showInUnified ?? true,
      );
    } catch (error) {
      if (String((error as Error).message).includes("UNIQUE")) throw new FlintError("conflict", "That account is already added.");
      throw error;
    }
    return this.requireAccount(id);
  }

  getAccount(id: AccountId): Account | null {
    const r = this.q.get<AccountRow>("SELECT * FROM accounts WHERE id = ?", id);
    return r ? rowToAccount(r) : null;
  }

  requireAccount(id: AccountId): Account {
    const a = this.getAccount(id);
    if (!a) throw new FlintError("not_found", "That account no longer exists.");
    return a;
  }

  getAccountByEmail(email: string): Account | null {
    const r = this.q.get<AccountRow>("SELECT * FROM accounts WHERE email = ?", email.trim().toLowerCase());
    return r ? rowToAccount(r) : null;
  }

  listAccounts(): Account[] {
    return this.q.all<AccountRow>("SELECT * FROM accounts ORDER BY sort_order, created_at, id").map(rowToAccount);
  }

  updateAccount(id: AccountId, patch: AccountPatch): Account {
    this.requireAccount(id);
    const sets: string[] = [];
    const params: (string | number | boolean | null)[] = [];
    for (const [key, value] of Object.entries(patch) as [keyof AccountPatch, unknown][]) {
      const column = COLUMNS[key];
      if (!column || value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(key === "aliases" ? JSON.stringify((value as string[]).map((a) => a.toLowerCase())) : key === "email" ? String(value).toLowerCase() : (value as string | number | boolean | null));
    }
    if (sets.length) this.q.run(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`, ...params, id);
    return this.requireAccount(id);
  }

  /** Removes the account with its mail, folders and drafts. Search index rows are cleared too. */
  deleteAccount(id: AccountId): void {
    tx(this.q.db, () => {
      this.q.run("DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE account_id = ?)", id);
      this.q.run("DELETE FROM messages WHERE account_id = ?", id);
      this.dropAccountFromSignatures(id);
      this.q.run("DELETE FROM accounts WHERE id = ?", id);
    });
  }

  /**
   * Signatures list their accounts in a JSON column, so no foreign key follows them. A signature only this account used goes
   * with it (as before); one shared with others just loses the account. The legacy account_id column is cleared so its
   * ON DELETE CASCADE can't remove a signature that other accounts still use.
   */
  private dropAccountFromSignatures(id: AccountId): void {
    this.q.run("UPDATE signatures SET account_id = NULL WHERE account_id = ?", id);
    for (const r of this.q.all<{ id: number; account_ids: string }>("SELECT id, account_ids FROM signatures WHERE account_ids <> '[]'")) {
      const ids: unknown = JSON.parse(r.account_ids);
      if (!Array.isArray(ids) || !ids.includes(id)) continue;
      const rest = ids.filter((x) => x !== id);
      if (rest.length === 0) this.q.run("DELETE FROM signatures WHERE id = ?", r.id);
      else this.q.run("UPDATE signatures SET account_ids = ? WHERE id = ?", JSON.stringify(rest), r.id);
    }
  }

  /** Lowercase addresses (primary and aliases) of every account: what counts as "me". */
  ownAddresses(): Set<string> {
    const out = new Set<string>();
    for (const a of this.listAccounts()) {
      out.add(a.email.toLowerCase());
      for (const alias of a.aliases) out.add(alias.toLowerCase());
    }
    return out;
  }
}
