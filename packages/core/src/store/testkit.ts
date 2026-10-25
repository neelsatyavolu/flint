import { openDb } from "../db/open";
import type { Account, Address, Folder } from "../types";
import { Store } from "./index";
import type { IngestMessage } from "./types";

/** Test helpers: in-memory store, seeded accounts, message builder. Not exported from the package index. */
export const me = (): Address => ({ name: "Me", address: "me@example.com" });
export const person = (name: string, address = `${name.toLowerCase()}@example.org`): Address => ({ name, address });

export function makeStore(): Store {
  return new Store(openDb(":memory:"));
}

const server = { imapHost: "imap.example.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.example.com", smtpPort: 465, smtpSecure: true };

export type ImapSeed = { account: Account; inbox: Folder; sent: Folder; trash: Folder; spam: Folder; drafts: Folder; archive: Folder };

export function seedImap(store: Store, email = "me@example.com"): ImapSeed {
  const account = store.createAccount({ ...server, email, name: "Me", provider: "imap", authKind: "password", username: email });
  const f = (path: string, role: Folder["role"]) => store.upsertFolder(account.id, { path, role });
  return { account, inbox: f("INBOX", "inbox"), sent: f("Sent", "sent"), trash: f("Trash", "trash"), spam: f("Junk", "spam"), drafts: f("Drafts", "drafts"), archive: f("Archive", "archive") };
}

export type GmailSeed = { account: Account; all: Folder; inbox: Folder; sent: Folder; trash: Folder; spam: Folder; drafts: Folder };

export function seedGmail(store: Store, email = "me@gmail.com"): GmailSeed {
  const account = store.createAccount({ ...server, email, name: "Me", provider: "gmail", authKind: "password", username: email });
  const f = (path: string, role: Folder["role"]) => store.upsertFolder(account.id, { path, role });
  return { account, all: f("[Gmail]/All Mail", "all"), inbox: f("INBOX", "inbox"), sent: f("[Gmail]/Sent Mail", "sent"), trash: f("[Gmail]/Trash", "trash"), spam: f("[Gmail]/Spam", "spam"), drafts: f("[Gmail]/Drafts", "drafts") };
}

let counter = 0;
export const DAY = 24 * 60 * 60 * 1000;
export const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

/** Builds an IngestMessage with sensible defaults. `uid` is required. */
export function msg(over: Partial<IngestMessage> & { uid: number }): IngestMessage {
  counter += 1;
  return {
    messageId: `m${counter}-${over.uid}@example.org`, inReplyTo: null, references: [], subject: "Hello", from: [person("Carla")],
    to: [me()], cc: [], bcc: [], replyTo: [], date: T0 + counter * 1000, flags: { seen: false, flagged: false, answered: false, draft: false },
    size: 1000, hasAttachments: false, headers: {}, ...over,
  };
}
