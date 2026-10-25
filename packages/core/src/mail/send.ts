import type { ImapFlow } from "imapflow";
import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { logger } from "../log";
import { FlintError, type Account, type Provider } from "../types";
import { buildMime, newMessageId, type MimeInput } from "./compose";
import { smtpOptions, describeConnectError, type MailAuth } from "./connect";
import { withMailbox, type ImapRunner } from "./runner";

const log = logger("mail.send");

export type Smtp = Transporter<SMTPTransport.SentMessageInfo>;

export function createSmtp(account: Account, auth: MailAuth): Smtp {
  return createTransport(smtpOptions(account, auth));
}

export type Envelope = { from: string; to: string[] };

/** Sends a finished message over SMTP to exactly the envelope recipients. */
export async function sendMessage(transport: Smtp, mime: Buffer, envelope: Envelope): Promise<void> {
  if (envelope.to.length === 0) throw new FlintError("invalid", "Add at least one recipient.");
  try {
    await transport.sendMail({ envelope: { from: envelope.from, to: envelope.to }, raw: mime });
  } catch (error) {
    throw describeSendError(error);
  }
}

function describeSendError(error: unknown): FlintError {
  const e = error as { responseCode?: number; response?: string };
  if (e.responseCode && e.responseCode >= 500 && e.responseCode < 600 && e.responseCode !== 535) {
    return new FlintError("invalid", `The server refused the message${e.response ? `: ${e.response.slice(0, 120)}` : "."}`);
  }
  return describeConnectError(error, "SMTP");
}

// ---------- Sent folder fix-up ----------

export type SentFolders = {
  provider: Provider;
  /** Path of the Sent folder. When null the server's \Sent special-use folder is used. */
  sentPath: string | null;
  /** Gmail only: Trash path, used to really delete a server-saved copy. */
  trashPath?: string | null;
  /** Wait times between searches for a server-saved copy (Gmail files its own copy a moment after SMTP). */
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
};

const sleepReal = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** APPEND. When the server refuses, create the folder (it may not exist yet) and try once more. */
async function appendCreating(c: ImapFlow, path: string, mime: Buffer, flags: string[]): Promise<Exclude<Awaited<ReturnType<ImapFlow["append"]>>, false>> {
  const attempt = async () => c.append(path, mime, flags).catch(() => false as const);
  const first = await attempt();
  if (first) return first;
  await c.mailboxCreate(path).catch(() => undefined);
  const second = await attempt();
  if (second) return second;
  throw new FlintError("network", "The server would not save the message.");
}

async function specialUsePath(runner: ImapRunner, use: string): Promise<string | null> {
  return runner.run(async (c) => (await c.list()).find((m) => m.specialUse === use)?.path ?? null);
}

async function findUids(runner: ImapRunner, path: string, messageId: string): Promise<number[]> {
  return runner.run(async (c) => {
    if (!(await c.list()).some((m) => m.path === path)) return [];
    return withMailbox(c, path, async () => {
      const found = await c.search({ header: { "message-id": `<${messageId}>` } }, { uid: true });
      return found || [];
    }, true);
  });
}

async function deleteUids(runner: ImapRunner, path: string, uids: number[]): Promise<void> {
  if (uids.length === 0) return;
  await runner.run((c) => withMailbox(c, path, async () => { await c.messageDelete(uids.join(","), { uid: true }); }));
}

/**
 * Leaves exactly one clean copy of a sent message in Sent: finds copies by Message-ID (the server may have saved
 * one with a tracking pixel), deletes them, then APPENDs the clean copy with \Seen.
 * Returns the UID of the appended copy when the server reports it.
 */
export async function fileSentCopy(runner: ImapRunner, folders: SentFolders, messageId: string, cleanMime: Buffer): Promise<{ path: string; uid: number | null }> {
  const sentPath = folders.sentPath ?? (await specialUsePath(runner, "\\Sent"));
  if (!sentPath) throw new FlintError("not_found", "This account has no Sent folder to save the message in.");
  const gmail = folders.provider === "gmail";
  const delays = folders.delaysMs ?? (gmail ? [0, 1500, 4000] : [0]);
  const sleep = folders.sleep ?? sleepReal;

  let found: number[] = [];
  for (const wait of delays) {
    if (wait > 0) await sleep(wait);
    found = await findUids(runner, sentPath, messageId);
    if (found.length > 0) break;
  }
  if (found.length > 0) {
    const trash = gmail ? (folders.trashPath ?? (await specialUsePath(runner, "\\Trash"))) : null;
    if (gmail && trash) {
      // Gmail keeps expunged mail in All Mail; moving to Trash and deleting there removes it for good.
      const moved = await runner.run((c) => withMailbox(c, sentPath, async () => c.messageMove(found.join(","), trash, { uid: true })));
      const trashed = moved && moved.uidMap ? [...moved.uidMap.values()] : await findUids(runner, trash, messageId);
      await deleteUids(runner, trash, trashed);
    } else {
      await deleteUids(runner, sentPath, found);
    }
  }
  const appended = await runner.run((c) => appendCreating(c, sentPath, cleanMime, ["\\Seen"]));
  return { path: sentPath, uid: appended.uid ?? null };
}

// ---------- Tracked and untracked sends ----------

export type TrackedRecipient = { address: string; token: string };

export type SendInput = {
  message: MimeInput;
  folders: SentFolders;
  /** Runs the Sent fix-up. Without it the message is sent and nothing is filed. */
  runner?: ImapRunner;
};

export type SendTrackedInput = SendInput & {
  /** One copy each, with a pixel for the token. */
  tracked: TrackedRecipient[];
  /** Addresses that get the clean message together in one envelope (the user's own addresses, recipients without tracking). */
  untracked: string[];
  injectPixel: (html: string, token: string) => string;
};

export type SendOutcome = {
  messageId: string;
  /** SMTP transactions that succeeded. */
  copies: number;
  failed: { address: string; error: string }[];
  sent: { path: string; uid: number | null } | null;
};

async function fileCopy(input: SendInput, messageId: string): Promise<SendOutcome["sent"]> {
  if (!input.runner) return null;
  try {
    const clean = await buildMime({ ...input.message, messageId, keepBcc: true });
    return await fileSentCopy(input.runner, input.folders, messageId, clean);
  } catch (error) {
    log.warn("could not file the sent copy", { reason: (error as Error).message });
    return null;
  }
}

export function allRecipients(m: Pick<MimeInput, "to" | "cc" | "bcc">): string[] {
  return [...new Set([...m.to, ...(m.cc ?? []), ...(m.bcc ?? [])].map((a) => a.address.trim()).filter(Boolean))];
}

/** One message to everyone in a single envelope, then the Sent fix-up. */
export async function sendUntracked(transport: Smtp, input: SendInput): Promise<SendOutcome> {
  const messageId = input.message.messageId ?? newMessageId(input.message.from.address);
  const mime = await buildMime({ ...input.message, messageId, keepBcc: false });
  await sendMessage(transport, mime, { from: input.message.from.address, to: allRecipients(input.message) });
  return { messageId, copies: 1, failed: [], sent: await fileCopy(input, messageId) };
}

/**
 * Per-recipient copies for read receipts. Every copy has the same headers and Message-ID and no Bcc header;
 * only the envelope recipient and the pixel differ. The user's own and untracked recipients share one clean copy.
 */
export async function sendTracked(transport: Smtp, input: SendTrackedInput): Promise<SendOutcome> {
  if (input.tracked.length === 0 && input.untracked.length === 0) throw new FlintError("invalid", "Add at least one recipient.");
  const messageId = input.message.messageId ?? newMessageId(input.message.from.address);
  const from = input.message.from.address;
  const failed: SendOutcome["failed"] = [];
  let copies = 0;

  for (const r of input.tracked) {
    try {
      const mime = await buildMime({ ...input.message, messageId, html: input.injectPixel(input.message.html, r.token), text: input.message.text, keepBcc: false });
      await sendMessage(transport, mime, { from, to: [r.address] });
      copies += 1;
    } catch (error) {
      failed.push({ address: r.address, error: (error as Error).message });
    }
  }
  if (input.untracked.length > 0) {
    try {
      const mime = await buildMime({ ...input.message, messageId, keepBcc: false });
      await sendMessage(transport, mime, { from, to: input.untracked });
      copies += 1;
    } catch (error) {
      for (const address of input.untracked) failed.push({ address, error: (error as Error).message });
    }
  }
  if (copies === 0) throw new FlintError("network", failed[0]?.error ?? "The message could not be sent.");
  return { messageId, copies, failed, sent: await fileCopy(input, messageId) };
}

// ---------- Server drafts ----------

/** Saves a draft to the server Drafts folder. Returns the new UID when the server reports it. */
export async function appendDraft(runner: ImapRunner, draftsPath: string, mime: Buffer): Promise<number | null> {
  const res = await runner.run((c) => appendCreating(c, draftsPath, mime, ["\\Draft", "\\Seen"]));
  return res.uid ?? null;
}

export async function deleteDraftByUid(runner: ImapRunner, draftsPath: string, uid: number): Promise<void> {
  await deleteUids(runner, draftsPath, [uid]);
}

/** Appends the new copy first, then removes the previous one, so a failure never leaves the server with no draft. */
export async function replaceDraft(runner: ImapRunner, draftsPath: string, previousUid: number | null, mime: Buffer): Promise<number | null> {
  const uid = await appendDraft(runner, draftsPath, mime);
  if (previousUid !== null) await deleteDraftByUid(runner, draftsPath, previousUid).catch((e) => log.warn("old draft copy not removed", { reason: (e as Error).message }));
  return uid;
}
