import type { ImapFlow } from "imapflow";
import type { Account } from "../types";
import { createImapClient, describeConnectError, type MailAuth } from "./connect";

/** Runs IMAP work on a connected client. AccountSync implements it with its long-lived command client. */
export interface ImapRunner {
  run<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T>;
}

/** Opens a fresh connection per call and logs out afterwards. For one-off work such as send and tests. */
export function oneShotRunner(account: Account, getAuth: () => Promise<MailAuth>): ImapRunner {
  return {
    async run(fn) {
      const client = createImapClient(account, await getAuth());
      client.on("error", () => undefined);
      try {
        await client.connect();
      } catch (error) {
        client.close();
        throw describeConnectError(error, "IMAP", account.imapHost);
      }
      try {
        return await fn(client);
      } finally {
        await client.logout().catch(() => client.close());
      }
    },
  };
}

/** Runs fn with the mailbox locked, always releasing the lock. */
export async function withMailbox<T>(client: ImapFlow, path: string, fn: () => Promise<T>, readOnly = false): Promise<T> {
  const lock = await client.getMailboxLock(path, { readOnly });
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
