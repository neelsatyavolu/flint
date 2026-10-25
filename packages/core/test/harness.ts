import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import { AccountSync, type AccountSyncOptions } from "../src/mail/sync/accountSync";
import type { MailAuth } from "../src/mail/connect";
import type { Store } from "../src/store";
import { makeStore } from "../src/store/testkit";
import type { Account, FlintEvent } from "../src/types";
import { TEST_DOMAIN, type GreenMail } from "./greenmail";

export async function waitFor<T>(fn: () => T | Promise<T>, what = "condition", timeoutMs = 15_000): Promise<NonNullable<T>> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v as NonNullable<T>;
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${(last as Error).message}` : ""}`);
}

export type Rig = {
  gm: GreenMail;
  store: Store;
  account: Account;
  auth: MailAuth;
  events: FlintEvent[];
  dataDir: string;
  sync: AccountSync;
  /** A separate IMAP connection to the same mailbox, for seeing what the server holds. */
  server<T>(fn: (c: ImapFlow) => Promise<T>, user?: string): Promise<T>;
};

/** Store + account + AccountSync for one GreenMail user. The sync loop is not started. */
export function makeRig(gm: GreenMail, name: string, extra: Partial<AccountSyncOptions> = {}): Rig {
  const user = gm.user(name);
  const store = makeStore();
  const account = store.createAccount({
    email: user.email, name: name[0]!.toUpperCase() + name.slice(1), provider: "imap", authKind: "password", username: name,
    imapHost: gm.host, imapPort: gm.imapPort, imapSecure: false, smtpHost: gm.host, smtpPort: gm.smtpPort, smtpSecure: false,
  });
  const auth: MailAuth = { user: name, pass: user.password };
  const events: FlintEvent[] = [];
  const dataDir = mkdtempSync(join(tmpdir(), "flint-test-"));
  const sync = new AccountSync({
    store, accountId: account.id, getAuth: async () => auth, emit: (e) => events.push(e), dataDir,
    pollMs: 500, idlePollMs: 5_000, backoff: { minMs: 200, maxMs: 1000 }, ...extra,
  });
  return {
    gm, store, account, auth, events, dataDir, sync,
    async server(fn, as = name) {
      const u = gm.user(as);
      const c = new ImapFlow({ host: gm.host, port: gm.imapPort, secure: false, auth: { user: as, pass: u.password }, logger: false });
      c.on("error", () => undefined);
      await c.connect();
      try {
        return await fn(c);
      } finally {
        await c.logout().catch(() => c.close());
      }
    },
  };
}

export const addr = (name: string): string => `${name}@${TEST_DOMAIN}`;

/** UIDs in a mailbox as the server reports them. */
export async function uidsIn(rig: Rig, path: string, as?: string): Promise<number[]> {
  return rig.server(async (c) => {
    const boxes = await c.list();
    if (!boxes.some((b) => b.path === path)) return [];
    const lock = await c.getMailboxLock(path, { readOnly: true });
    try {
      const found = await c.search({ all: true }, { uid: true });
      return Array.isArray(found) ? found : [];
    } finally {
      lock.release();
    }
  }, as);
}

export async function sourcesIn(rig: Rig, path: string, as?: string): Promise<string[]> {
  return rig.server(async (c) => {
    const boxes = await c.list();
    if (!boxes.some((b) => b.path === path)) return [];
    const lock = await c.getMailboxLock(path, { readOnly: true });
    try {
      const out: string[] = [];
      for (const m of await c.fetchAll("1:*", { source: true }, { uid: false })) out.push(m.source?.toString("utf8") ?? "");
      return out;
    } finally {
      lock.release();
    }
  }, as);
}
